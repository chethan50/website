import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { createServer } from 'http';
import { Server } from 'socket.io';
import prisma from './db.js';

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
    methods: ['GET', 'POST']
  }
});

const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' })); // Increased limit for base64 images

// Health check
app.get('/health', (_, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// API Routes
app.use('/api/panels', panelsRouter);
app.use('/api/technicians', techniciansRouter);
app.use('/api/tickets', ticketsRouter);
app.use('/api/faults', faultsRouter);
app.use('/api/weather', weatherRouter);
app.use('/api/analytics', analyticsRouter);
app.use('/api/solar-scans', solarScansRouter);

// Socket.io handling for Raspberry Pi image uploads
io.on('connection', (socket) => {
  console.log('🔌 Client connected:', socket.id);

  // Listen for thermal image data from Raspberry Pi
  socket.on('thermal-image', async (data) => {
    try {
      console.log('📷 Received thermal image from Pi:', data.panelId);
      
      // Data expected from Pi:
      // {
      //   panelId: string,
      //   rgbImage: base64 string,
      //   thermalImage: base64 string,
      //   analysis: {
      //     faultType: string,
      //     severity: string,
      //     confidence: number,
      //     description: string,
      //     recommendedAction: string
      //   },
      //   locationX?: number,
      //   locationY?: number
      // }

      // Create fault detection record
      const faultDetection = await prisma.faultDetection.create({
        data: {
          panelId: data.panelId,
          detectedAt: new Date(),
          severity: data.analysis?.severity || 'medium',
          faultType: data.analysis?.faultType || 'unknown',
          droneImageUrl: data.rgbImage || null,  // RGB image stored here
          thermalImageUrl: data.thermalImage || null,  // Thermal image stored here
          aiConfidence: data.analysis?.confidence || 0,
          aiAnalysis: data.analysis?.description || '',
          recommendedAction: data.analysis?.recommendedAction || '',
          locationX: data.locationX || 0,
          locationY: data.locationY || 0,
        }
      });

      // Create a ticket for this fault
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
        }
      });

      // Emit to all connected clients that new data is available
      io.emit('new-fault-detection', {
        panelId: data.panelId,
        faultDetection,
        timestamp: new Date()
      });

      // Acknowledge receipt to the Pi
      socket.emit('image-received', {
        success: true,
        panelId: data.panelId,
        message: 'Image and analysis stored successfully'
      });

      console.log('✅ Fault detection and ticket created for panel:', data.panelId);
    } catch (error) {
      console.error('❌ Error processing thermal image:', error);
      socket.emit('image-received', {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  socket.on('disconnect', () => {
    console.log('🔌 Client disconnected:', socket.id);
  });
});

// Error handling middleware
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('Error:', err.message);
  res.status(500).json({ error: 'Internal server error' });
});

// Start server
httpServer.listen(PORT, () => {
  console.log(`🚀 Solar Guardian API running on http://localhost:${PORT}`);
  console.log(`📊 Health check: http://localhost:${PORT}/health`);
  console.log(`🔌 Socket.io enabled for real-time data`);
});

export default app;
export { io };

