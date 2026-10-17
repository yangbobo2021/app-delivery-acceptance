"""Freeze optional same-run per-line coverage from a project-supplied collector."""
import hashlib
import json
from pathlib import Path
import subprocess


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def freeze_coverage(spec, root, execution_dir, receipt_path, destination):
    spec = spec or {"policy": "unavailable", "reason": "No project coverage collector was supplied"}
    policy = spec.get("policy")
    if policy in ("off", "unavailable"):
        result = {"status": policy, "reason": spec.get("reason", "Collection explicitly skipped" if policy == "off" else "Collector unavailable")}
    elif policy == "required":
        if spec.get('provider') == 'istanbul-source-v1':
            report = Path(execution_dir) / 'coverage-report.json'
            provider = Path(__file__).resolve().parents[2] / 'scripts/coverage-istanbul/provider.mjs'
            subprocess.run(['node', str(provider), 'verify', str(report)], check=True,
                           stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            result = json.loads(report.read_text())
            if result['execution_sha256'] != sha(receipt_path):
                raise ValueError('Dedicated coverage is bound to another execution')
            from coverage_collection_check import check_collection
            lifecycle=check_collection((Path(execution_dir)/'execution.log').read_text(errors='replace'),sha(receipt_path))
            result['collection_check']=lifecycle
            if lifecycle['status']=='incomplete':
                result['status']='incomplete'
                result['reason']='；'.join(lifecycle['limitations'])
            path = Path(destination).parent / (Path(destination).name + '.json')
            path.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
            return result, path
        raise ValueError('required coverage needs a registered dedicated provider and verified preparation; legacy LCOV/tool labels alone cannot be measured')
    else:
        raise ValueError("coverage policy must be required, unavailable or off")
    # Preserve actual tool provenance for the view; absence remains unknown.
    # This metadata alone never certifies the provider or a measured value.
    if spec.get("tools"):
        result["tools"] = spec["tools"]
    if spec.get("tool"):
        result["tool"] = spec["tool"]
    path = Path(destination).parent / (Path(destination).name + ".json")
    path.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
    return result, path
