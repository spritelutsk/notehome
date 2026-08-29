# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

This repository contains a Python script for pairing with Android TV devices using the Remote v2 protocol. The script establishes a secure connection, performs pairing via PIN exchange, and maintains a persistent connection to the TV.

## Key Components

- `pair.py`: Main script that handles the pairing process and connection management
- `cert.pem`: SSL certificate generated during pairing (created automatically)
- `key.pem`: SSL private key used for authentication (created automatically)
- `pin.txt`: Temporary file used to receive PIN code from user during pairing
- `pair.log`: Log file capturing output from pairing sessions

## Development Setup

The project uses a Python virtual environment located at `.venv`. To activate it:

```bash
source .venv/bin/activate
```

## Common Commands

### Running the Pairing Script

To run the pairing script:
```bash
python pair.py
```

The script will:
1. Load or generate SSL certificates
2. Connect to the Android TV at the host specified in `TV_HOST` environment variable (defaults to 192.168.1.106)
3. Initiate pairing sequence and display instructions
4. Wait for user to enter PIN in `pin.txt` file
5. Complete pairing and save certificates
6. Establish persistent connection and display device information

### Environment Variables

- `TV_HOST`: IP address or hostname of the Android TV device (default: 192.168.1.106)

### Re-pairing

If you need to re-pair with the TV:
1. Delete the existing certificate and key files: `rm cert.pem key.pem`
2. Run the script again: `python pair.py`
3. Follow the on-screen instructions

## How It Works

1. The script uses the `androidtvremote2` library to communicate with Android TV devices
2. During first run, it generates a unique SSL certificate/key pair for secure communication
3. It initiates the pairing process which displays a PIN on the TV screen
4. The user must enter this PIN into the `pin.txt` file within 5 minutes
5. Once pairing is complete, the script connects to the TV and displays device information
6. The connection is maintained until manually interrupted

## Notes

- The script requires network access to the Android TV device
- Ensure port 6467 is accessible on the TV (default for Remote v2 protocol)
- Certificate and key files contain sensitive authentication material - treat them as credentials
- The PIN entry method is deliberately simple for demonstration purposes - in production you might want a more secure input method