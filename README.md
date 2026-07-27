# Chess.com Games Downloader

This script downloads a user's games from Chess.com and saves them as PGN files. It supports downloading games for multiple users in parallel and ensures that existing files are not overwritten.

## Features

- Download games for multiple Chess.com users.
- Save games in PGN format.
- Organize games by username.
- Skip downloading if the file already exists.
- Perform downloads in parallel for faster execution.

## Requirements

- Python 3.x
- `requests` library
- `argparse` library

## Installation

1. Clone the repository:

    ```sh
    git clone https://github.com/yourusername/chesscom-games-downloader.git
    cd chesscom-games-downloader
    ```

2. Install the required libraries:

    ```sh
    pip install requests
    ```

## Usage

To run the script, use the following command:

```sh
python download_chesscom_games.py <username1> <username2> ... <base_directory>
```

## Tilt Mirror (web app)

**Live app:** [https://artvandelay.github.io/download_chesscom_games/](https://artvandelay.github.io/download_chesscom_games/)

Bring-your-own-key chess psychology analyzer. Runs fully in the browser (no server):

1. **Load games** — fetch from Chess.com by username (public API, free), or upload `.pgn` files exported from Chess.com Archive.
2. **Paste your LLM API key** — OpenAI, Anthropic, Gemini, OpenRouter, or Mock (facts-only report, no key needed).
3. **Generate report** — code computes verified facts; the LLM only writes the coaching prose.

Source lives in [`docs/`](docs/). Details: [`docs/README.md`](docs/README.md).