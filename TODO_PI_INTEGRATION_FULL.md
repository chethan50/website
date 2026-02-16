# Raspberry Pi Full Integration TODO

## Task: Integrate full laptop_receiver.py functionality into Solar Guardian

### Steps:
1. [ ] Update server/src/index.ts - Add Socket.IO handler for pi_analysis_result event
2. [ ] Update src/hooks/usePiReceiver.ts - Update default URL to local server (port 3000)
3. [ ] Test the integration

## Implementation Details:

### 1. Server (server/src/index.ts)
- Add Socket.IO handler for `pi_analysis_result` event (from Raspberry Pi)
- Save received images to disk:
  - Main captured image (frame_b64)
  - Panel crop images (panel_crops with image_b64)
- Store scan data in database using SolarScan/PanelDetection models
- Broadcast `new_result` to all connected web clients

### 2. Frontend Hook (src/hooks/usePiReceiver.ts)
- Update default URL from localhost:5000 to localhost:3000 (local server port)

### 3. Frontend Page (src/pages/Scans.tsx)
- Already integrated - verify display works correctly
