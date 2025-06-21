# Fair Chase: A 3D Ethical Deer Hunting Simulation

Welcome to Fair Chase, a 3D deer hunting simulation designed to showcase modular game development with Three.js and emphasize ethical hunting practices.

## Description

Fair Chase offers an immersive hunting experience where players can explore diverse 3D environments, track and hunt deer with realistic AI, and manage their progress through a journal system. The game features multiple selectable worlds, each with unique terrain and flora, a dynamic day/night cycle affecting visibility and animal behavior, and a scoring system that rewards ethical shots.

This project was developed with a focus on clean, modular code, demonstrating how a complex browser-based game can be organized for maintainability and scalability.

## Technologies Used

*   **Three.js:** For 3D graphics rendering and scene management.
*   **Tone.js:** For synthesizing sound effects.
*   **JavaScript (ES6 Modules):** For game logic and modular code structure.

## Setup Instructions

1.  **Get the Code:** Clone this repository or download the game files to your local machine.
2.  **Web Browser:** Ensure you have a modern web browser (e.g., Chrome, Firefox, Edge, Safari) with JavaScript enabled.
3.  **Running the Game:**
    *   **Recommended:** For the best experience and to avoid potential issues with browser security policies regarding local file access (especially for loading textures and modules), run a simple local HTTP server in the project's root directory. 
        *   If you have Python installed, navigate to the project directory in your terminal and run: `python -m http.server` (for Python 3) or `python -m SimpleHTTPServer` (for Python 2). Then open `http://localhost:8000` (or the port indicated) in your browser.
        *   Alternatively, use a development tool like VS Code with the "Live Server" extension.
    *   **Direct File Access (Not Recommended for Development):** You can try opening the `index.html` file directly in your browser, but this may lead to issues with loading game assets or modules depending on your browser's security settings.

## Controls

*   **W, A, S, D:** Move player forward, left, backward, and right.
*   **Mouse Movement:** Look around the environment.
*   **Left Click:** 
    *   Shoot (when aiming down sights/scoped).
    *   Interact with UI elements (buttons, modals).
*   **Right Click (Hold):** Aim down sights (scope in with the rifle).
*   **E:** Tag a downed deer (when the prompt 'Press [E] to Tag Deer' is visible).
*   **J:** Open or close the Hunter's Journal modal.
*   **M:** Open or close the Map modal.
*   **ESC:** 
    *   Release mouse pointer lock (to interact with UI or browser).
    *   Close any open modal (Journal, Map, End-of-Day Report).

## Codebase Overview

The game's JavaScript code is organized into several modules for clarity and maintainability:

*   `js/main.js`: Core game loop, initialization, state management, and `gameContext` assembly.
*   `js/scene.js`: Handles Three.js scene setup, camera, lighting, and sky/fog effects.
*   `js/world.js`: Manages terrain generation, tree placement, water bodies, and world-specific configurations.
*   `js/world-presets.js`: Contains configuration data for different selectable game worlds.
*   `js/player.js`: Controls player movement, camera, input handling (keyboard/mouse), and shooting mechanics.
*   `js/deer.js`: Implements deer AI (states: wandering, grazing, alert, fleeing, etc.), model creation, and behavior logic.
*   `js/ui.js`: Manages all HUD elements (compass, messages, interaction prompts), modals (journal, map, end-of-day report), and UI event handling.
*   `js/audio.js`: Handles sound effect synthesis and playback (e.g., gunshot).
*   `js/constants.js`: Defines global constants used throughout the application (e.g., game speed, fog density, entity sizes).

## Gameplay Notes

*   **Ethical Hunting:** The game encourages ethical hunting. Aim for vital organ shots for a clean harvest. Scoring reflects shot placement and animal state.
*   **Deer Behavior:** Deer are sensitive to your presence. Move slowly and use cover. Loud noises like gunshots will spook them.
*   **Journaling:** At the end of each in-game day (or when choosing to sleep), a report is generated. Successful hunts are recorded in your journal.
*   **World Exploration:** Try out different worlds from the main menu to experience varied terrains and challenges.

Enjoy the hunt!
