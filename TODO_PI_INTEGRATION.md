# TODO: Pi Receiver Integration in Scans Page

## Task
Add Pi Receiver connection UI to display live scans from Raspberry Pi in the Scans page.

## Current State
- usePiReceiver hook is imported but UI is not displayed
- Need to add connection status UI

## Steps:
1. [ ] Add Pi Connection Status Card in Scans.tsx
   - Show connection status (connected/disconnected/connecting)
   - Show server URL input
   - Show connect/disconnect button
   - Show error message if any
   - Show total live scans received

2. [ ] Display Pi scans in the scans list
   - Combine piScans with regular scans
   - Or show them in a separate section

3. [ ] Update the filters section to include Pi scans option

## Files to Edit:
- Solar-guardian/src/pages/Scans.tsx
