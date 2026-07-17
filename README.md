# Kiocast KioskShell

A professional, lightweight, and highly customizable Electron-based kiosk browser designed for interactive touch displays.

## Features

- **Secure Kiosk Environment**: Locks down the interface to prevent unauthorized access to the underlying OS.
- **Windows OS Lockdown**: Built-in utility to disable native Windows touch keyboards, edge swipes, and multi-finger gestures (requires Administrator privileges).
- **Customizable Virtual Keyboard**: Professional, touch-friendly onscreen keyboard with floating and fixed docking modes.
- **Hidden Admin Panel**: Accessible via a secure 5-tap gesture on the top-left KIOCAST logo, protected by a configurable PIN.
- **Domain Whitelisting**: Restrict browsing entirely to approved domains and subdomains to prevent unwanted navigation.
- **Quick Navigation**: Configurable quick-access buttons for frequently visited URLs directly from the top bar.
- **Idle Timeout & Screensaver**: Automatically returns to a safe state or idle screen after a configurable period of inactivity.
- **Activity Logging**: Built-in activity logs for monitoring usage and tracking system events.
- **Modern UI**: Light theme designed for readability, clear touch targets, and proper feedback states for interactive elements.

## Settings & Configuration

All configurations can be managed directly through the built-in Admin Panel. 

**Accessing the Admin Panel:**
1. Tap the **KIOCAST** logo in the top-left corner **5 times rapidly**.
2. Enter the Admin PIN.

**Available Settings Categories:**
- **Display**: Configure the start URL, idle timeout, zoom lock, and text selection lock.
- **Buttons**: Manage the Quick Navigation buttons shown in the top bar.
- **Security**: Update the Admin PIN and configure virtual keyboard behavior (auto-show, fixed vs floating).
- **Domains**: Add or remove approved domains for the built-in whitelist.
- **Admin**: Advanced actions including **Windows OS Lockdown**, Cache Clearing, Factory Reset, and Application Exit.
- **Log**: View application events, blocks, and system status.

## Development & Build

### Prerequisites
- [Node.js](https://nodejs.org/) (v18+ recommended)
- Git

### Installation
Clone the repository and install dependencies:
```bash
git clone https://github.com/signcastdesign/kiocast-kioskmode.git
cd kiocast-kioskmode
npm install
```

### Running Locally
To start the application in development mode:
```bash
npm start
```

### Building for Production
To package the application into a Windows executable (`.exe`):
```bash
npm run dist -- --win
```
The installer will be generated in the `dist/` directory.