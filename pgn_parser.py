import os
import chess.pgn
import logging

def parse_pgn_files(input_dir: str) -> list:
    logger = logging.getLogger()
    games_data = []
    for root, _, files in os.walk(input_dir):
        for filename in files:
            if filename.endswith(".pgn"):
                filepath = os.path.join(root, filename)
                logger.info("Reading file: %s", filepath)
                with open(filepath, 'r') as file:
                    while True:
                        game = chess.pgn.read_game(file)
                        if game is None:
                            break
                        game_data = {
                            "moves": list(game.mainline_moves()),
                            "white": game.headers["White"],
                            "black": game.headers["Black"],
                            "result": game.headers["Result"],
                            "white_rating": game.headers.get("WhiteElo"),
                            "black_rating": game.headers.get("BlackElo"),
                            "time_control": game.headers.get("TimeControl"),
                            "event": game.headers.get("Event"),
                            "site": game.headers.get("Site"),
                            "date": game.headers.get("Date"),
                            "round": game.headers.get("Round"),
                            "eco": game.headers.get("ECO"),
                            "termination": game.headers.get("Termination"),
                            "link": game.headers.get("Link")
                        }
                        games_data.append(game_data)
                        # logger.info("Parsed game: %s vs %s, Result: %s", game.headers["White"], game.headers["Black"], game.headers["Result"])
    return games_data