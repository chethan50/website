import { Router, Request, Response } from 'express';
import prisma from '../db.js';

const router = Router();

// =====================================================
// RASPBERRY PI DATA ENDPOINTS
// =====================================================

// POST /api/solar-scans - Receive scan data from Raspberry Pi
router.post('/', async (req: Request, res: Response) => {
  try {
    const {
      timestamp,
      priority,
      thermal,
      panels,
      deviceId,
      deviceName,
      thermalImage,
      rgbImage
    } = req.body;

    // Count dusty and clean panels
    const dustyPanelCount = panels?.filter((p: any) => p.status === 'DUSTY').length || 0;
    const cleanPanelCount = panels?.filter((p: any) => p.status === 'CLEAN').length || 0;
    const totalPanels = panels?.length || 0;

    // Create SolarScan record
    const scan = await prisma.solarScan.create({
      data: {
        timestamp: timestamp ? new Date(timestamp) : new Date(),
        priority: priority || 'NORMAL',
        status: 'pending',
        
        // Thermal data
        thermalMinTemp: thermal?.min_temp || null,
        thermalMaxTemp: thermal?.max_temp || null,
        thermalMeanTemp: thermal?.mean_temp || null,
        thermalDelta: thermal?.delta || null,
        riskScore: thermal?.risk_score || null,
        severity: thermal?.severity || null,
        thermalImageUrl: thermalImage || null,
        rgbImageUrl: rgbImage || null,
        
        // Summary counts
        dustyPanelCount,
        cleanPanelCount,
        totalPanels,
        
        // Device info
        deviceId: deviceId || null,
        deviceName: deviceName || null,
      }
    });

    // Create PanelDetection records for each panel
    if (panels && panels.length > 0) {
      await Promise.all(
        panels.map((panel: any) => 
          prisma.panelDetection.create({
            data: {
              scanId: scan.id,
              panelNumber: panel.panel_number || panel.panelNumber || 'Unknown',
              status: panel.status || 'UNKNOWN',
              x1: panel.x1 || panel.bbox?.[0] || 0,
              y1: panel.y1 || panel.bbox?.[1] || 0,
              x2: panel.x2 || panel.bbox?.[2] || 0,
              y2: panel.y3 || panel.bbox?.[3] || 0,
              cropImageUrl: panel.crop || panel.cropImageUrl || null,
              faultType: panel.faultType || null,
              confidence: panel.confidence || null,
            }
          })
        )
      );
    }

    res.status(201).json({
      success: true,
      scanId: scan.id,
      message: 'Solar scan recorded successfully'
    });
  } catch (error) {
    console.error('Error saving solar scan:', error);
    res.status(500).json({ error: 'Failed to save solar scan data' });
  }
});

// GET /api/solar-scans - Get all scans
router.get('/', async (req: Request, res: Response) => {
  try {
    const { status, limit = 50 } = req.query;

    const where: any = {};
    if (status) {
      where.status = status;
    }

    const scans = await prisma.solarScan.findMany({
      where,
      include: {
        panelDetections: true
      },
      orderBy: { timestamp: 'desc' },
      take: Number(limit)
    });

    res.json(scans);
  } catch (error) {
    console.error('Error fetching solar scans:', error);
    res.status(500).json({ error: 'Failed to fetch solar scans' });
  }
});

// GET /api/solar-scans/latest - Get latest scan
router.get('/latest', async (_req: Request, res: Response) => {
  try {
    const scan = await prisma.solarScan.findFirst({
      orderBy: { timestamp: 'desc' },
      include: {
        panelDetections: true
      }
    });

    if (!scan) {
      return res.status(404).json({ error: 'No scans found' });
    }

    res.json(scan);
  } catch (error) {
    console.error('Error fetching latest scan:', error);
    res.status(500).json({ error: 'Failed to fetch latest scan' });
  }
});

// GET /api/solar-scans/:id - Get scan by ID
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const scan = await prisma.solarScan.findUnique({
      where: { id: req.params.id },
      include: {
        panelDetections: true
      }
    });

    if (!scan) {
      return res.status(404).json({ error: 'Scan not found' });
    }

    res.json(scan);
  } catch (error) {
    console.error('Error fetching scan:', error);
    res.status(500).json({ error: 'Failed to fetch scan' });
  }
});

// PATCH /api/solar-scans/:id - Update scan status
router.patch('/:id', async (req: Request, res: Response) => {
  try {
    const { status } = req.body;

    const scan = await prisma.solarScan.update({
      where: { id: req.params.id },
      data: {
        status,
        updatedAt: new Date()
      }
    });

    res.json(scan);
  } catch (error) {
    console.error('Error updating scan:', error);
    res.status(500).json({ error: 'Failed to update scan' });
  }
});

// DELETE /api/solar-scans/:id - Delete scan
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    await prisma.solarScan.delete({
      where: { id: req.params.id }
    });

    res.json({ success: true, message: 'Scan deleted' });
  } catch (error) {
    console.error('Error deleting scan:', error);
    res.status(500).json({ error: 'Failed to delete scan' });
  }
});

// GET /api/solar-scans/stats/summary - Get scan statistics
router.get('/stats/summary', async (_req: Request, res: Response) => {
  try {
    const totalScans = await prisma.solarScan.count();
    const pendingScans = await prisma.solarScan.count({ where: { status: 'pending' } });
    const processedScans = await prisma.solarScan.count({ where: { status: 'processed' } });
    
    const criticalScans = await prisma.solarScan.count({ 
      where: { severity: 'CRITICAL' } 
    });
    
    const highRiskScans = await prisma.solarScan.count({ 
      where: { severity: { in: ['CRITICAL', 'HIGH'] } } 
    });

    // Average thermal delta
    const avgThermalDelta = await prisma.solarScan.aggregate({
      _avg: { thermalDelta: true }
    });

    res.json({
      totalScans,
      pendingScans,
      processedScans,
      criticalScans,
      highRiskScans,
      avgThermalDelta: avgThermalDelta._avg.thermalDelta || 0
    });
  } catch (error) {
    console.error('Error fetching scan stats:', error);
    res.status(500).json({ error: 'Failed to fetch scan statistics' });
  }
});

export default router;
