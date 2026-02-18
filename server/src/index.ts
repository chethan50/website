import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { createServer } from 'http';
import { Server } from 'socket.io';
import prisma from './db.js';
import path from 'path';
import fs from 'fs';

// Routes
import panelsRouter from './routes/panels.js';
import techniciansRouter from './routes/technicians.js';
import ticketsRouter from './routes/tickets.js';
import faultsRouter from './routes/faults.js';
import weatherRouter from './routes/weather.js';
import analyticsRouter from './routes/analytics.js';
import solarScansRouter from './routes/solarScans.js';

dotenv.config();

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
});

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const MAX_PI_RESULTS = 50;

// Directory to save received images from Pi
const PI_SAVE_DIR = path.join(process.cwd(), 'received_from_pi');
const CAPTURES_DIR = path.join(PI_SAVE_DIR, 'captures');
const PANEL_CROPS_DIR = path.join(PI_SAVE_DIR, 'panel_crops');

// Create directories if they don't exist
[PI_SAVE_DIR, CAPTURES_DIR, PANEL_CROPS_DIR].forEach((dir) => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    console.log(`Created directory: ${dir}`);
  }
});

// Middleware
app.use(cors());
app.use(express.json({ limit: '100mb' })); // increased limit for base64 images
app.use('/api/pi-images', express.static(PI_SAVE_DIR));

// ─── Types ────────────────────────────────────────────────────────────────────

type PiPanelCropInput = {
  panel_number?: string;
  status?: 'CLEAN' | 'DUSTY' | 'FAULTY' | 'UNKNOWN';
  has_dust?: boolean;
  image_b64?: string;
  thermal_image_b64?: string;
  x1?: number;
  y1?: number;
  x2?: number;
  y2?: number;
};

// ── FIX: added thermal_stats field (Pi sends this instead of thermal) ─────────
type ThermalBlock = {
  min_temp?: number;
  max_temp?: number;
  mean_temp?: number;
  delta?: number;
  risk_score?: number;
  severity?: 'CRITICAL' | 'HIGH' | 'MODERATE' | 'LOW';
  // Extra fields Pi includes in thermal_stats
  fault?: string;
  baseline_delta?: number;
};

type PiAnalysisResultInput = {
  capture_id?: string | number;
  timestamp?: string;
  report?: {
    health_score?: number;
    priority?: 'HIGH' | 'MEDIUM' | 'NORMAL';
    recommendation?: string;
    timeframe?: string;
    summary?: string;
    root_cause?: string;
    impact_assessment?: string;
    source?: string;
    baseline_aware?: boolean;
    deviation_from_baseline?: string;
    genai_insights?: string;
  };
  rgb_stats?: {
    total?: number;
    clean?: number;
    dusty?: number;
  };
  frame_b64?: string;
  thermal_b64?: string;
  thermal?: ThermalBlock;        // new pi_server.py sends this
  thermal_stats?: ThermalBlock;  // old pi_server.py sends this — keep for compatibility
  panel_crops?: PiPanelCropInput[];
  device_id?: string;
  device_name?: string;
};

type PiResultForClients = {
  id: string;
  capture_id: string;
  timestamp: string;
  received_at: string;
  report: {
    health_score: number;
    priority: 'HIGH' | 'MEDIUM' | 'NORMAL';
    recommendation: string;
    timeframe: string;
    summary: string;
    root_cause: string;
    impact_assessment: string;
    source: string;
    baseline_aware: boolean;
    deviation_from_baseline: string;
    genai_insights: string;
  };
  rgb_stats: {
    total: number;
    clean: number;
    dusty: number;
  };
  main_image_web: string | null;
  thermal_image_web: string | null;
  thermal: {
    min_temp: number | null;
    max_temp: number | null;
    mean_temp: number | null;
    delta: number | null;
    risk_score: number | null;
    severity: 'CRITICAL' | 'HIGH' | 'MODERATE' | 'LOW' | null;
  };
  panel_crops: Array<{
    panel_number: string;
    status: 'CLEAN' | 'DUSTY' | 'FAULTY' | 'UNKNOWN';
    has_dust: boolean;
    web_path: string | null;
    thermal_web_path: string | null;
    x1: number;
    y1: number;
    x2: number;
    y2: number;
  }>;
};

const piResults: PiResultForClients[] = [];

// ─── Helpers ──────────────────────────────────────────────────────────────────

const makeTimestampSuffix = () => {
  const now = new Date();
  const pad = (v: number) => v.toString().padStart(2, '0');
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
};

const sanitizeFilePart = (value: string) => value.replace(/[^a-zA-Z0-9_-]/g, '_');

const decodeBase64Image = (rawData: string) => {
  const parts = rawData.split(',');
  const base64Data = parts.length > 1 ? parts[1] : parts[0];
  return Buffer.from(base64Data, 'base64');
};

const toDataUrl = (rawData?: string | null) => {
  if (!rawData) return null;
  if (rawData.startsWith('data:image/')) return rawData;
  return `data:image/jpeg;base64,${rawData}`;
};

const getSeverityFromHealthScore = (healthScore: number): 'CRITICAL' | 'HIGH' | 'MODERATE' | 'LOW' => {
  if (healthScore < 30) return 'CRITICAL';
  if (healthScore < 50) return 'HIGH';
  if (healthScore < 75) return 'MODERATE';
  return 'LOW';
};

// ─── Health check ─────────────────────────────────────────────────────────────

app.get('/health', (_, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ─── API Routes ───────────────────────────────────────────────────────────────

app.use('/api/panels', panelsRouter);
app.use('/api/technicians', techniciansRouter);
app.use('/api/tickets', ticketsRouter);
app.use('/api/faults', faultsRouter);
app.use('/api/weather', weatherRouter);
app.use('/api/analytics', analyticsRouter);
app.use('/api/solar-scans', solarScansRouter);

app.get('/api/pi-results', (_req, res) => {
  res.json({ total: piResults.length, results: piResults });
});

app.delete('/api/pi-results/:id', (req, res) => {
  const targetId = req.params.id;
  const before = piResults.length;
  const next = piResults.filter((r) => r.id !== targetId);
  piResults.length = 0;
  piResults.push(...next);
  res.json({ success: true, removed: before - next.length });
});

// ─── Socket.IO ────────────────────────────────────────────────────────────────

io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);

  // Send already-received Pi results to freshly connected clients
  piResults.forEach((result) => {
    socket.emit('new_result', result);
  });

  // ── Legacy thermal-image event ─────────────────────────────────────────────
  socket.on('thermal-image', async (data) => {
    try {
      console.log('Received thermal image from Pi:', data.panelId);

      const faultDetection = await prisma.faultDetection.create({
        data: {
          panelId: data.panelId,
          detectedAt: new Date(),
          severity: data.analysis?.severity || 'medium',
          faultType: data.analysis?.faultType || 'unknown',
          droneImageUrl: data.rgbImage || null,
          thermalImageUrl: data.thermalImage || null,
          aiConfidence: data.analysis?.confidence || 0,
          aiAnalysis: data.analysis?.description || '',
          recommendedAction: data.analysis?.recommendedAction || '',
          locationX: data.locationX || 0,
          locationY: data.locationY || 0,
        },
      });

      const ticketNumber = `TKT-${Date.now()}`;
      await prisma.ticket.create({
        data: {
          ticketNumber,
          panelId: data.panelId,
          faultId: faultDetection.id,
          status: 'open',
          priority: data.analysis?.severity === 'high' ? 'high' : 'medium',
          createdAt: new Date(),
          updatedAt: new Date(),
          description: data.analysis?.description || 'Fault detected via thermal imaging',
          faultType: data.analysis?.faultType || 'unknown',
          droneImageUrl: data.rgbImage || null,
          thermalImageUrl: data.thermalImage || null,
          aiAnalysis: data.analysis?.description || null,
          recommendedAction: data.analysis?.recommendedAction || null,
        },
      });

      io.emit('new-fault-detection', { panelId: data.panelId, faultDetection, timestamp: new Date() });
      socket.emit('image-received', { success: true, panelId: data.panelId, message: 'Stored successfully' });
      console.log('Fault detection and ticket created for panel:', data.panelId);
    } catch (error) {
      console.error('Error processing thermal image:', error);
      socket.emit('image-received', {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  // ── Main Pi payload handler ────────────────────────────────────────────────
  socket.on(
    'pi_analysis_result',
    async (
      data: PiAnalysisResultInput,
      ack?: (response: { success: boolean; scanId?: string; error?: string }) => void
    ) => {
      try {
        // ── Validation ──────────────────────────────────────────────────────
        if (!data?.capture_id || !data?.report) {
          const response = { success: false, error: 'Missing required fields (capture_id/report)' };
          socket.emit('pi-analysis-received', response);
          if (ack) ack(response);
          return;
        }

        console.log(`[Pi] Received pi_analysis_result capture_id=${data.capture_id}`);

        const captureId = String(data.capture_id);
        const healthScore = Number(data.report.health_score ?? 0);
        const priority = data.report.priority ?? 'NORMAL';
        const receivedAt = new Date();
        const timestampSuffix = makeTimestampSuffix();
        const safeCaptureId = sanitizeFilePart(captureId);

        // ── FIX: read 'thermal' first, fall back to 'thermal_stats' ─────────
        // The Pi sends 'thermal_stats'; newer pi_server.py also sends 'thermal'.
        // Either way we now read from whichever key is present.
        const thermalBlock: ThermalBlock = data.thermal ?? data.thermal_stats ?? {};
        console.log(`[Pi] thermal source: ${data.thermal ? 'thermal' : data.thermal_stats ? 'thermal_stats' : 'NONE'}`);
        console.log(`[Pi] thermal values: min=${thermalBlock.min_temp} max=${thermalBlock.max_temp} delta=${thermalBlock.delta}`);

        // ── Save images to disk ──────────────────────────────────────────────
        let mainImageWebPath: string | null = null;
        let thermalImageWebPath: string | null = null;
        const mainImageDataUrl = toDataUrl(data.frame_b64);
        const thermalImageDataUrl = toDataUrl(data.thermal_b64);

        if (data.frame_b64) {
          try {
            const captureFileName = `capture_${safeCaptureId}_${timestampSuffix}.jpg`;
            const captureFilePath = path.join(CAPTURES_DIR, captureFileName);
            fs.writeFileSync(captureFilePath, decodeBase64Image(data.frame_b64));
            mainImageWebPath = `/api/pi-images/captures/${captureFileName}`;
            console.log(`[Pi] Saved RGB image: ${captureFileName}`);
          } catch (imgErr) {
            console.warn('[Pi] Failed to save RGB image:', imgErr);
          }
        }

        if (data.thermal_b64) {
          try {
            const thermalFileName = `thermal_${safeCaptureId}_${timestampSuffix}.jpg`;
            const thermalFilePath = path.join(CAPTURES_DIR, thermalFileName);
            fs.writeFileSync(thermalFilePath, decodeBase64Image(data.thermal_b64));
            thermalImageWebPath = `/api/pi-images/captures/${thermalFileName}`;
            console.log(`[Pi] Saved thermal image: ${thermalFileName}`);
          } catch (imgErr) {
            console.warn('[Pi] Failed to save thermal image:', imgErr);
          }
        }

        // ── Save panel crop images ───────────────────────────────────────────
        const panelCropsInput = Array.isArray(data.panel_crops) ? data.panel_crops : [];
        const panelCropsForClients: PiResultForClients['panel_crops'] = [];

        panelCropsInput.forEach((crop, index) => {
          const panelNumber = crop.panel_number ?? `P${index + 1}`;
          const status = crop.status ?? 'UNKNOWN';
          const hasDust = crop.has_dust ?? status === 'DUSTY';
          let webPath: string | null = null;
          let thermalWebPath: string | null = null;
          const rgbDataUrl = toDataUrl(crop.image_b64);
          const thermalDataUrl = toDataUrl(crop.thermal_image_b64);
          const x1 = Number(crop.x1 ?? 0);
          const y1 = Number(crop.y1 ?? 0);
          const x2 = Number(crop.x2 ?? 0);
          const y2 = Number(crop.y2 ?? 0);

          if (crop.image_b64) {
            try {
              const cropFileName = `panel_${sanitizeFilePart(panelNumber)}_cap${safeCaptureId}_${timestampSuffix}.jpg`;
              const cropFilePath = path.join(PANEL_CROPS_DIR, cropFileName);
              fs.writeFileSync(cropFilePath, decodeBase64Image(crop.image_b64));
              webPath = `/api/pi-images/panel_crops/${cropFileName}`;
            } catch (cropErr) {
              console.warn(`[Pi] Failed to save crop ${panelNumber}:`, cropErr);
            }
          }

          if (crop.thermal_image_b64) {
            try {
              const thermalCropFileName = `thermal_panel_${sanitizeFilePart(panelNumber)}_cap${safeCaptureId}_${timestampSuffix}.jpg`;
              const thermalCropFilePath = path.join(PANEL_CROPS_DIR, thermalCropFileName);
              fs.writeFileSync(thermalCropFilePath, decodeBase64Image(crop.thermal_image_b64));
              thermalWebPath = `/api/pi-images/panel_crops/${thermalCropFileName}`;
            } catch (thermalCropErr) {
              console.warn(`[Pi] Failed to save thermal crop ${panelNumber}:`, thermalCropErr);
            }
          }

          panelCropsForClients.push({
            panel_number: panelNumber,
            status,
            has_dust: hasDust,
            web_path: rgbDataUrl || webPath,
            thermal_web_path: thermalDataUrl || thermalWebPath,
            x1,
            y1,
            x2,
            y2,
          });
        });

        // ── Derive counts + severity ─────────────────────────────────────────
        const dustyPanelCount = data.rgb_stats?.dusty ?? panelCropsForClients.filter(c => c.status === 'DUSTY').length;
        const cleanPanelCount = data.rgb_stats?.clean ?? panelCropsForClients.filter(c => c.status === 'CLEAN').length;
        const totalPanels = data.rgb_stats?.total ?? panelCropsForClients.length;

        const severity = thermalBlock.severity ?? getSeverityFromHealthScore(healthScore);
        const riskScore = thermalBlock.risk_score ?? Math.max(0, Math.min(100, Math.round(100 - healthScore)));
        const thermalMinTemp = thermalBlock.min_temp ?? null;
        const thermalMaxTemp = thermalBlock.max_temp ?? null;
        const thermalMeanTemp = thermalBlock.mean_temp ?? null;
        const thermalDelta = thermalBlock.delta ?? null;

        console.log(`[Pi] Saving to DB: severity=${severity} riskScore=${riskScore} panels=${totalPanels}`);

        // ── Save to database ─────────────────────────────────────────────────
        const savedScan = await prisma.solarScan.create({
          data: {
            timestamp: receivedAt,
            priority,
            status: 'pending',
            riskScore,
            severity,
            thermalMinTemp,
            thermalMaxTemp,
            thermalMeanTemp,
            thermalDelta,
            thermalImageUrl: thermalImageDataUrl || thermalImageWebPath,
            rgbImageUrl: mainImageDataUrl || mainImageWebPath,
            dustyPanelCount,
            cleanPanelCount,
            totalPanels,
            deviceId: data.device_id ?? 'raspberry-pi',
            deviceName: data.device_name ?? 'Raspberry Pi Scanner',
            aiHealthScore: Math.round(healthScore),
            aiRecommendation: data.report.recommendation ?? null,
            aiSummary: data.report.summary ?? null,
            aiRootCause: data.report.root_cause ?? null,
            aiImpactAssessment: data.report.impact_assessment ?? null,
            aiTimeframe: data.report.timeframe ?? null,
            aiSource: data.report.source ?? null,
            aiBaselineAware: data.report.baseline_aware ?? null,
            aiDeviationFromBaseline: data.report.deviation_from_baseline ?? null,
            aiGenaiInsights: data.report.genai_insights ?? null,
            panelDetections: {
              create: panelCropsForClients.map((crop) => ({
                panelNumber: crop.panel_number,
                status: crop.status,
                x1: crop.x1, y1: crop.y1, x2: crop.x2, y2: crop.y2,
                cropImageUrl: crop.web_path,
                thermalCropImageUrl: crop.thermal_web_path || thermalImageDataUrl || thermalImageWebPath,
                faultType: crop.has_dust ? 'dust' : null,
                confidence: null,
              })),
            },
          },
        });

        console.log(`[Pi] Saved scan to DB: ${savedScan.id}`);

        // ── Build result for browser clients ─────────────────────────────────
        const resultForClients: PiResultForClients = {
          id: savedScan.id,
          capture_id: captureId,
          timestamp: receivedAt.toISOString(),
          received_at: receivedAt.toISOString(),
          report: {
            health_score: healthScore,
            priority,
            recommendation: data.report.recommendation ?? '',
            timeframe: data.report.timeframe ?? '',
            summary: data.report.summary ?? '',
            root_cause: data.report.root_cause ?? '',
            impact_assessment: data.report.impact_assessment ?? '',
            source: data.report.source ?? 'fallback',
            baseline_aware: data.report.baseline_aware ?? false,
            deviation_from_baseline: data.report.deviation_from_baseline ?? 'N/A',
            genai_insights: data.report.genai_insights ?? '',
          },
          rgb_stats: { total: totalPanels, clean: cleanPanelCount, dusty: dustyPanelCount },
          main_image_web: mainImageDataUrl || mainImageWebPath,
          thermal_image_web: thermalImageDataUrl || thermalImageWebPath,
          thermal: {
            min_temp: thermalMinTemp,
            max_temp: thermalMaxTemp,
            mean_temp: thermalMeanTemp,
            delta: thermalDelta,
            risk_score: riskScore,
            severity,
          },
          panel_crops: panelCropsForClients,
        };

        piResults.unshift(resultForClients);
        if (piResults.length > MAX_PI_RESULTS) piResults.length = MAX_PI_RESULTS;

        // ── Broadcast to all browser clients ─────────────────────────────────
        io.emit('new_result', resultForClients);
        io.emit('new-solar-scan', { scanId: savedScan.id, source: 'pi_analysis_result' });

        const response = { success: true, scanId: savedScan.id };
        socket.emit('pi-analysis-received', response);
        if (ack) ack(response);

        console.log(`[Pi] ✅ Broadcast complete for capture #${captureId}`);
      } catch (error) {
        console.error('[Pi] ❌ Error processing pi_analysis_result:', error);
        const response = {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
        socket.emit('pi-analysis-received', response);
        if (ack) ack(response);
      }
    }
  );

  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
  });
});

// ─── Error middleware ─────────────────────────────────────────────────────────

app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('Error:', err.message);
  res.status(500).json({ error: 'Internal server error' });
});

// ─── Start server ─────────────────────────────────────────────────────────────

httpServer.listen(Number(PORT), HOST, () => {
  console.log(`Solar Guardian API running on http://localhost:${PORT}`);
  console.log(`Solar Guardian API listening on ${HOST}:${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/health`);
  console.log('Socket.io enabled for real-time data');
});

export default app;
export { io };
