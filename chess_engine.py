import chess.engine

def evaluate_moves(games_data: list, engine_path: str, config: dict) -> list:
    engine = chess.engine.SimpleEngine.popen_uci(engine_path)
    evaluation_results = []
    for game in games_data:
        board = chess.Board()
        for move in game["moves"]:
            board.push(move)
            info = engine.analyse(board, chess.engine.Limit(depth=config.get("depth", 20)))
            evaluation_results.append({
                "move": move,
                "score": info["score"].relative.score()
            })
    engine.quit()
    return evaluation_results