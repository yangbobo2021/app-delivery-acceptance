import argparse
import json

from .store import InsufficientStock, reserve


def main():
    parser = argparse.ArgumentParser(description='Reserve stock from an inventory JSON file.')
    parser.add_argument('--state', required=True)
    parser.add_argument('--sku', required=True)
    parser.add_argument('--quantity', required=True, type=int)
    args = parser.parse_args()
    try:
        print(json.dumps({'remaining': reserve(args.state, args.sku, args.quantity)}))
    except InsufficientStock:
        parser.exit(2, 'insufficient stock\n')


if __name__ == '__main__':
    main()
