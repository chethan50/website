import { Router, Request, Response } from 'express';
import prisma from '../db.js';

const router = Router();

// Get all panels with optional filtering
router.get('/', async (req: Request, res: Response) => {
  try {
    const { status, zone, search } = req.query;
    const zoneFilter = typeof zone === 'string' && ['A', 'B'].includes(zone) ? zone : undefined;

    const where = {
      row: { lte: 3 },
      column: { lte: 3 },
      zone: zoneFilter
        ? { is: { name: zoneFilter } }
        : { is: { name: { in: ['A', 'B'] } } },
      ...(typeof status === 'string' ? { status } : {}),
      ...(typeof search === 'string' && search.trim()
        ? { panelId: { contains: search.trim(), mode: 'insensitive' as const } }
        : {}),
    };

    const panels = await prisma.solarPanel.findMany({
      where,
      include: { zone: true },
      orderBy: [{ zone: { name: 'asc' } }, { row: 'asc' }, { column: 'asc' }],
    });

    res.json(panels);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('Error fetching panels:', message);
    res.status(500).json({ 
      error: 'Failed to fetch panels', 
      details: process.env.NODE_ENV === 'development' ? message : undefined 
    });
  }
});

// Get panel statistics
router.get('/stats', async (_req: Request, res: Response) => {
  try {
    const [
      totalPanels,
      healthyPanels,
      warningPanels,
      faultPanels,
      offlinePanels,
      currentGeneration,
    ] = await Promise.all([
      prisma.solarPanel.count(),
      prisma.solarPanel.count({ where: { status: 'healthy' } }),
      prisma.solarPanel.count({ where: { status: 'warning' } }),
      prisma.solarPanel.count({ where: { status: 'fault' } }),
      prisma.solarPanel.count({ where: { status: 'offline' } }),
      prisma.solarPanel.aggregate({
        _sum: { currentOutput: true },
      }),
    ]);

    const maxCapacity = totalPanels * 400; // Assuming 400W per panel
    const currentGen = currentGeneration._sum.currentOutput || 0;
    const avgEfficiency = await prisma.solarPanel.aggregate({
      _avg: { efficiency: true },
      where: { status: { not: 'offline' } },
    });

    res.json({
      totalPanels,
      healthyPanels,
      warningPanels,
      faultPanels,
      offlinePanels,
      currentGeneration: currentGen / 1000, // Convert to kW
      maxCapacity: maxCapacity / 1000,
      efficiency: avgEfficiency._avg.efficiency || 0,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('Error fetching panel stats:', message);
    res.status(500).json({ error: 'Failed to fetch panel statistics' });
  }
});

// Get single panel by ID
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const panel = await prisma.solarPanel.findUnique({
      where: { id: req.params.id },
      include: {
        zone: true,
        tickets: {
          orderBy: { createdAt: 'desc' },
          take: 5,
        },
        faultDetections: {
          orderBy: { detectedAt: 'desc' },
          take: 5,
        },
      },
    });

    if (!panel) {
      return res.status(404).json({ error: 'Panel not found' });
    }

    res.json(panel);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('Error fetching panel:', message);
    res.status(500).json({ error: 'Failed to fetch panel' });
  }
});

// Get panels by zone
router.get('/zone/:zoneName', async (req: Request, res: Response) => {
  try {
    const panels = await prisma.solarPanel.findMany({
      where: {
        zone: { name: req.params.zoneName },
      },
      orderBy: [{ row: 'asc' }, { column: 'asc' }],
    });

    res.json(panels);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('Error fetching zone panels:', message);
    res.status(500).json({ error: 'Failed to fetch zone panels' });
  }
});

export default router;

