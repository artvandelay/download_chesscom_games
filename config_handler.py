import yaml
import json

def load_config(config_path: str) -> dict:
    if config_path.endswith(".yaml") or config_path.endswith(".yml"):
        with open(config_path, 'r') as file:
            return yaml.safe_load(file)
    elif config_path.endswith(".json"):
        with open(config_path, 'r') as file:
            return json.load(file)
    else:
        return {}  # Return default settings if no config file is found