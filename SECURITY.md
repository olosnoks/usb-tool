# Security Policy

Skon's USB Tool is a client-side hardware security and reverse-engineering
workbench. It runs entirely in the browser (Web Serial / WebUSB / WASM) with no
backend, so the primary attack surface is the static web app itself and the way
it handles data from connected devices and imported files.

## Supported Versions

Only the latest version deployed from the `main` branch
(https://olosnoks.github.io/usb-tool/) is supported. There are no long-term
support branches; fixes land on `main` and deploy automatically.

## Reporting a Vulnerability

**Please do not open a public issue for security vulnerabilities.**

Report privately through GitHub's private vulnerability reporting:

1. Go to the repository's **Security** tab → **Report a vulnerability**
   (GitHub Security Advisories), or
2. Open a draft advisory at
   https://github.com/olosnoks/usb-tool/security/advisories/new

Please include:

- A description of the issue and its impact.
- Steps to reproduce (a minimal repro, affected tool/workbench, and browser).
- Any relevant logs, payloads, or sample files (sanitized).

You can expect an initial acknowledgement within a few days. Once a fix is
prepared it will be deployed to `main`, and the advisory will be published with
credit to the reporter unless anonymity is requested.

## Scope

In scope:

- XSS, prototype pollution, or unsafe parsing in the web app (e.g. handling of
  imported PCAP/firmware/JSON files or data streamed from a connected device).
- Supply-chain issues in the build/dependency graph.
- Logic flaws that could cause the tool to send unintended data to a device.

Out of scope:

- Issues that require a malicious browser extension or a compromised host OS.
- The intended, documented capabilities of the tool itself. This is an offensive
  and defensive hardware-security toolkit; features such as firmware flashing,
  monitor-mode capture, BadUSB payload authoring, and RFID/NFC auditing are
  working as designed.

## Responsible Use

This project is intended for authorized security research, education, hardware
development, and testing on equipment you own or are permitted to test.
Monitor-mode Wi-Fi capture, keystroke-injection payloads, and RF tooling are
regulated in many jurisdictions. You are responsible for complying with all
applicable laws and for having authorization before using these capabilities.
