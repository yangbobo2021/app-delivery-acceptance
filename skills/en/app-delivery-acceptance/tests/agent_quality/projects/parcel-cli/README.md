# Parcel CLI

Python 3.10+ command-line inventory reservation library. No runtime dependencies.
Run `python3 -m parcel --help` for the command entry.
Run `python3 -m unittest discover -s tests -v` for the project tests.
Development dependencies are in requirements-dev.txt; use an isolated virtual environment.

Public behavior: reserve a positive integer quantity of one SKU from a JSON inventory file.
If enough stock exists, return the remaining quantity and save that quantity in the file,
leaving all other SKUs unchanged. If stock is insufficient, raise InsufficientStock and
leave the entire inventory file unchanged. The CLI reports this rejection with exit code 2.
The library and CLI use the same store implementation. Each test uses its own temporary file.
