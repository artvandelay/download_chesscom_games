import os

def generate_report(analysis_results: dict, output_dir: str) -> None:
    report_path = os.path.join(output_dir, "report.md")
    with open(report_path, 'w') as file:
        file.write("# Chess Game Analysis Report\n\n")
        
        # Win Loss Statistics
        file.write("## Win Loss Statistics\n")
        win_loss_stats = analysis_results.get("win_loss_statistics", {})
        for key, value in win_loss_stats.items():
            file.write(f"- {key}: {value}\n")
        file.write("\n")
        
        # Opening Analysis
        file.write("## Opening Analysis\n")
        opening_analysis = analysis_results.get("opening_analysis", {})
        for key, value in opening_analysis.items():
            file.write(f"- {key}: {value}\n")
        file.write("\n")
        
        # Move Quality
        file.write("## Move Quality\n")
        move_quality = analysis_results.get("move_quality", {})
        for key, value in move_quality.items():
            file.write(f"- {key}: {value}\n")
        file.write("\n")