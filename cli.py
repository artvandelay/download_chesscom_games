import argparse
import logging
from config_handler import load_config
from pgn_parser import parse_pgn_files
from analysis_engine import analyze_games
from report_generator import generate_report

def main():
    # Configure logging
    logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
    logger = logging.getLogger()

    parser = argparse.ArgumentParser(description="Chess Game Analysis Tool")
    parser.add_argument("username", type=str, help="Chess.com username")
    parser.add_argument("base_dir", type=str, help="The base directory where the PGN files are saved.")
    parser.add_argument("--config", type=str, default="config.yaml", help="Path to configuration file")
    args = parser.parse_args()

    logger.info("Loading configuration from %s", args.config)
    config = load_config(args.config)
    logger.info("Configuration loaded successfully")

    logger.info("Parsing PGN files from directory %s", args.base_dir)
    games_data = parse_pgn_files(args.base_dir)
    logger.info("Parsed %d games", len(games_data))

    logger.info("Analyzing games")
    analysis_results = analyze_games(games_data, config)
    logger.info("Analysis completed")

    logger.info("Generating report")
    generate_report(analysis_results, args.base_dir)
    logger.info("Report generated successfully at %s/report.md", args.base_dir)

if __name__ == "__main__":
    main()