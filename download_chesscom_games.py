# Source: https://github.com/arnsholt/chesscom-games/blob/master/chesscom-games.py

from codecs import open
from datetime import date
import os
import requests
import pdb

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

if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser(description="Download a user's games from chess.com")
    parser.add_argument('user', metavar='USER', help='The user whose games we want')
    parser.add_argument('where', metavar='PATH', help='Where to create the PGN files',
            default=".", nargs='?')
    args = parser.parse_args()
    main(args.user, args.where)
