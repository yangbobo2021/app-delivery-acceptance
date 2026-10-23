import json
from pathlib import Path


class InsufficientStock(Exception):
    pass


def reserve(path, sku, quantity):
    path = Path(path)
    inventory = json.loads(path.read_text())
    if inventory[sku] < quantity:
        raise InsufficientStock(sku)
    inventory[sku] -= quantity
    path.write_text(json.dumps(inventory))
    return inventory[sku]
