# Source: https://github.com/arnsholt/chesscom-games/blob/master/chesscom-games.py

from codecs import open
from datetime import date
import os
import requests
import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed

def main(user, where):
    print("Downloading %s's games to %s:" % (user, where))
    latest_pgn = sorted(os.listdir(where))[-1]
    os.remove(os.path.join(where, latest_pgn))
    print(f'Removing the latest {latest_pgn} and download that month again')
    for archive in get('https://api.chess.com/pub/player/%s/games/archives' % user)['archives']:
        download_archive(archive, where)

def download_archive(url, where):
    games = get(url)['games']
    d = date.fromtimestamp(games[0]['end_time'])
    y = d.year
    m = d.month
    filename = f'{y}-{m:02}.pgn' 
    filepath = os.path.join(where, filename) 
    filelist = os.listdir(where)
    # pdb.set_trace()
    if filename in filelist: 
        print(f'Already downloaded file: {filename}, skipping')
        return

    print('Starting work on %s...' % filepath)
    # XXX: If a file with this name already exists, we'll blow away the old
    # one. Possibly not ideal.
    with open(filepath, 'w', encoding='utf-8') as output:
        for game in games:
            # print(f'Games:{games}')
            print(game['pgn'], file=output)

def get(url):
    return requests.get(url).json()

def download_games(user, base_dir):
    """
    Download a user's games from Chess.com and save them as PGN files.

    Args:
        user (str): The Chess.com username.
        base_dir (str): The base directory where the PGN files will be saved.
    """
    headers = {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.114 Safari/537.36"
    }
    base_url = f"https://api.chess.com/pub/player/{user}/games/archives"
    response = requests.get(base_url, headers=headers)

    # Check if the response is valid JSON
    try:
        archives = response.json().get('archives', [])
    except requests.exceptions.JSONDecodeError:
        print(f"Error: Unable to decode JSON response for user {user}")
        return

    user_dir = os.path.join(base_dir, user)
    if not os.path.exists(user_dir):
        os.makedirs(user_dir)

    tasks = []
    with ThreadPoolExecutor(max_workers=5) as executor:
        for archive_url in archives:
            year_month = archive_url.split('/')[-2:]
            filename = f"{year_month[0]}-{year_month[1]}.pgn"
            filepath = os.path.join(user_dir, filename)

            # Skip downloading if the file already exists
            if os.path.exists(filepath):
                print(f"Skipping {filename} for user {user}, already exists.")
                continue

            pgn_url = f"https://api.chess.com/pub/player/{user}/games/{year_month[0]}/{year_month[1]}/pgn"
            tasks.append(executor.submit(download_and_save_pgn, pgn_url, filepath, headers, user, filename))

        for future in as_completed(tasks):
            future.result()

def download_and_save_pgn(pgn_url, filepath, headers, user, filename):
    """
    Download and save the PGN file.

    Args:
        pgn_url (str): The URL to download the PGN file.
        filepath (str): The path to save the PGN file.
        headers (dict): The headers to use for the request.
        user (str): The Chess.com username.
        filename (str): The name of the file being downloaded.
    """
    pgn_response = requests.get(pgn_url, headers=headers)
    with open(filepath, 'w') as file:
        file.write(pgn_response.text)
    print(f"Downloaded {filename} for user {user}")

def main():
    parser = argparse.ArgumentParser(description="Download Chess.com games for a list of users.")
    parser.add_argument("users", type=str, nargs='+', help="The Chess.com usernames.")
    parser.add_argument("base_dir", type=str, help="The base directory where the PGN files will be saved.")
    args = parser.parse_args()

    with ThreadPoolExecutor(max_workers=5) as executor:
        futures = [executor.submit(download_games, user, args.base_dir) for user in args.users]
        for future in as_completed(futures):
            future.result()

if __name__ == "__main__":
    main()
