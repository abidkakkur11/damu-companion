# Damu Companion

A friendly desktop companion built with Electron that sits on your screen, wanders around, and reminds you to stay hydrated and take regular breaks — with Malayalam dialogue banter!

![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)

## Features

- **Hydration & Break Reminders**: Timely notifications to drink water and stretch your legs.
- **Lively Companion**: Walks, stands, sits, jumps, and reacts to clicks and dragging across your screen.
- **Malayalam Dialogues**: Authentic Malayalam chatter and speech bubbles ("*Vellam kudichille?*", "*Konjam ezhunnettu nadakku*", "*Njan pokoola..!*").
- **System Tray Controls**: Configure reminder intervals (water, break, chatter frequency), pause/resume, or toggle visibility.
- **Custom Animations**: Transparent sprite sequences rendered on an untainted HTML5 Canvas.

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) (v18 or higher recommended)
- `npm`

### Installation

Clone the repository and install dependencies:

```bash
git clone https://github.com/abidkakkur11/damu-companion.git
cd damu-companion
npm install
```

### Running Locally

Launch Damu in development mode:

```bash
npm start
```

### Packaging for Production

Build the Windows installer (NSIS):

```bash
npm run dist
```

The output setup installer will be placed in the `dist/` directory.

## License

This project is licensed under the [MIT License](LICENSE).
