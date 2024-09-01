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