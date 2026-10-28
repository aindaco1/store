#!/usr/bin/env python3
"""Create a review candidate using Platform's postal updater; never advance a pin."""
import pathlib
import runpy
runpy.run_path(str(pathlib.Path(__file__).resolve().parents[1] / 'shared/dust-wave-platform/packages/tax-core/bin/update-us-postal.py'), run_name='__main__')
