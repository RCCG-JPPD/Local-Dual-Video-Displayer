# Multi-Screen Video Player (Electron)

A simple Electron-based video player that spans three displays:

1. **Public Screen** – fullscreen video with audio  
2. **Private Screen** – fullscreen video, muted  
3. **Controller Screen** – windowed UI for playlist, playback, scrub bar, and volume control

All windows stay always-on-top (screen-saver level) and restore themselves if minimized or hidden.

---

## 🔧 Features

- **Cross-platform video formats**  
  Plays any format supported by your OS (MP4, MOV, MKV, AVI, WebM, M4V, WMV, etc.)

- **Flexible file picker**  
  Choose one or more videos from anywhere on your PC via a native dialog.

- **Playlist management**  
  • Add / Remove files  
  • Next / Previous navigation  
  • Auto-advance through the list

- **Playback controls**  
  • Play / Pause toggle  
  • Scrub bar with elapsed and total time  
  • Volume slider (affects **public** window only)

- **Persistent “always on top”**  
  All three windows periodically reset their top-most status and prevent being hidden or minimized.

---

## 🚀 Quick Start

### Prerequisites

- **Node.js & npm** installed  
- **Windows** (tested on Windows 10/11)

### Installation

1. Clone or download this repo  
2. Install dependencies  
   ```bash
   npm install

	3.	Run the app

npm start



⸻

🗂 Project Structure

your-app/
├── main.js            # Main process: window creation, IPC, dialogs, always-on-top enforcement
├── video-view.html    # Shared view for public & private video windows
├── controller.html    # Controller UI: playlist, controls, scrub bar, volume
└── electron_data/     # Auto-created: app data & Chromium cache


⸻

⚙️ How It Works
	1.	main.js
	•	Sets userData and cache to electron_data/.
	•	Creates three BrowserWindow instances, positioned on monitors 1, 2, and 3.
	•	Mutes the private screen.
	•	Exposes an IPC handler for open-file-dialog to pick videos.
	•	Forwards all playback commands (load, play, pause, seek, setVolume) from the controller to both video windows.
	•	Listens for video-time updates from the public window to update the scrub bar and time labels on the controller.
	•	Runs a repeating timer to keep windows always on top and prevent minimization/hiding.
	2.	video-view.html
	•	Hosts a single <video> element that loads & plays files via IPC commands.
	•	Sends back current time & duration at 500 ms intervals.
	3.	controller.html
	•	Renders a <select>-based playlist.
	•	“Add…” button opens native file picker (via ipcRenderer.invoke).
	•	Play/Pause, Next/Prev buttons control playback.
	•	A <input type="range"> scrub bar and time display reflect & control playback position.
	•	A volume slider sends setVolume commands (0–1 range).

⸻

🛠 Future Enhancements
	•	Persisted playlists (save & restore on launch)
	•	Drag-and-drop support in controller pane
	•	Keyboard shortcuts (Space, ←/→, Up/Down for volume)
	•	Thumbnail previews in playlist items
	•	Theming / custom CSS for controller UI

⸻

📄 License

This project is released under the MIT License. See LICENSE for details.
