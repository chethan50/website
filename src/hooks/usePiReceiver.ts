import { useState, useEffect, useCallback, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import { PiAnalysisResult, convertPiResultToSolarScan, SolarScan } from '@/types/solar';

export interface PiReceiverState {
  isConnected: boolean;
  isConnecting: boolean;
  error: string | null;
  piScans: SolarScan[];
  totalPiScans: number;
  serverUrl: string;
}

export interface UsePiReceiverReturn extends PiReceiverState {
  connect: (url: string) => void;
  disconnect: () => void;
  clearPiScans: () => void;
}

// Default URL - can be configured via environment variable or user input
const DEFAULT_PI_RECEIVER_URL = import.meta.env.VITE_PI_RECEIVER_URL || 'http://localhost:3000';

export function usePiReceiver(): UsePiReceiverReturn {
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [piScans, setPiScans] = useState<SolarScan[]>([]);
  const [serverUrl, setServerUrl] = useState(DEFAULT_PI_RECEIVER_URL);
  
  const socketRef = useRef<Socket | null>(null);

  const connect = useCallback((url: string) => {
    // Disconnect existing connection if any
    if (socketRef.current) {
      socketRef.current.disconnect();
    }

    setIsConnecting(true);
    setError(null);
    setServerUrl(url);

    try {
      const socket = io(url, {
        transports: ['websocket', 'polling'],
        reconnection: true,
        reconnectionAttempts: 5,
        reconnectionDelay: 1000,
        timeout: 10000,
      });

      socket.on('connect', () => {
        console.log('🔌 Connected to Pi Receiver:', url);
        setIsConnected(true);
        setIsConnecting(false);
        setError(null);
      });

      socket.on('disconnect', (reason) => {
        console.log('🔌 Disconnected from Pi Receiver:', reason);
        setIsConnected(false);
      });

      socket.on('connect_error', (err) => {
        console.error('❌ Connection error:', err.message);
        setError(err.message);
        setIsConnecting(false);
        setIsConnected(false);
      });

      socket.on('new_result', (data: PiAnalysisResult) => {
        console.log('📥 Received Pi analysis result:', data);
        try {
          const solarScan = convertPiResultToSolarScan(data);
          setPiScans(prev => [solarScan, ...prev].slice(0, 50)); // Keep last 50 scans
        } catch (err) {
          console.error('❌ Error converting Pi result:', err);
        }
      });

      socketRef.current = socket;
    } catch (err) {
      console.error('❌ Failed to create socket:', err);
      setError(err instanceof Error ? err.message : 'Failed to connect');
      setIsConnecting(false);
    }
  }, []);

  const disconnect = useCallback(() => {
    if (socketRef.current) {
      socketRef.current.disconnect();
      socketRef.current = null;
    }
    setIsConnected(false);
    setIsConnecting(false);
  }, []);

  const clearPiScans = useCallback(() => {
    setPiScans([]);
  }, []);

  // Auto-connect on mount with default URL
  useEffect(() => {
    // Only auto-connect if URL is configured and not already connected
    if (DEFAULT_PI_RECEIVER_URL && !socketRef.current) {
      connect(DEFAULT_PI_RECEIVER_URL);
    }
    
    return () => {
      if (socketRef.current) {
        socketRef.current.disconnect();
        socketRef.current = null;
      }
    };
  }, [connect]);

  return {
    isConnected,
    isConnecting,
    error,
    piScans,
    totalPiScans: piScans.length,
    serverUrl,
    connect,
    disconnect,
    clearPiScans,
  };
}
