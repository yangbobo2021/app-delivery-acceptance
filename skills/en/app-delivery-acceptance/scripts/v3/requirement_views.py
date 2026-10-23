"""Read-only requirement presentation, bound to the original text."""
import hashlib


def attach_requirement_presentations(rows, shared):
    from acceptance_store import read
    path = shared / 'requirement-display.json'
    names, warning = {}, ''
    if path.is_file():
        try:
            value = read(path)
            if value.get('schema') != 'acceptance-requirement-display-v1' or value.get('acceptance_id') != shared.name:
                raise ValueError('schema or acceptance ID differs')
            if not isinstance(value.get('requirements'), list):
                raise ValueError('requirements must be a list')
            for item in value['requirements']:
                if (not isinstance(item, dict) or not all(isinstance(item.get(k), str) and item[k].strip()
                            for k in ['id', 'title', 'summary', 'text_sha256']) or
                        item['id'] in names or not isinstance(item.get('rules', []), list) or
                        not all(isinstance(x, str) and x.strip() for x in item.get('rules', []))):
                    raise ValueError('invalid or duplicate requirement presentation')
                names[item['id']] = item
        except (ValueError, OSError, KeyError, TypeError) as error:
            names, warning = {}, '阅读说明暂不可用，原始需求仍可查看：' + str(error)
    for trace in rows:
        presentations = {}
        for req in [*trace.get('requirements', []), *trace.get('reverse_rules', [])]:
            item = names.get(req['id'])
            if item:
                actual = hashlib.sha256(str(req.get('text', '')).encode()).hexdigest()
                presentations[req['id']] = ({'title': item['title'], 'summary': item['summary'],
                    'rules': list(item.get('rules', []))} if item['text_sha256'] == actual else
                    {'warning': '需求原文已变化，阅读摘要待更新；请查看原始需求。'})
            elif warning:
                presentations[req['id']] = {'warning': warning}
        trace['requirement_presentations'] = presentations


DIALOG_CSS = r'''
html{scrollbar-gutter:stable}body.requirement-modal-open{overflow:hidden}
.requirement-title{display:block;text-align:left;font-weight:700;line-height:1.55;color:#243832;padding:5px 0}
.requirement-preview{font-size:13px;line-height:1.65;color:#62756d;margin:8px 0;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
.requirement-open{font-size:13px;font-weight:600;margin-top:5px}
.case-card>.requirement-title{font-size:14px;padding:0}.requirement-content .clamp{display:block;overflow:visible;-webkit-line-clamp:unset}.requirement-content .clamp+button[data-expand]{display:none}.requirement-content .case-field{margin:18px 0}.requirement-content .case-label{margin-bottom:6px}
.requirement-dialog{width: min(960px,calc(100vw - 64px));max-width:960px;height:min(800px,calc(100dvh - 64px));max-height:calc(100dvh - 64px);padding:0;border:1px solid #dbe5df;border-radius:18px;color:#243832;background:#fff;box-shadow:0 24px 80px #10281f40;overflow:hidden}
.requirement-dialog[open]{display:flex;flex-direction:column}.requirement-dialog::backdrop{background:#172d2666;backdrop-filter:blur(3px)}
.requirement-dialog-header{display:flex;align-items:flex-start;gap:20px;padding:24px 28px 18px;flex-shrink:0}
.requirement-dialog-heading{flex:1;min-width:0}.requirement-dialog h2{font-size:22px;line-height:1.45;margin:0 0 8px;overflow-wrap:anywhere}
.requirement-close{width:40px;height:40px;flex-shrink:0;border-radius:10px;background:#f3f6f3;font-size:26px;line-height:1;color:#425b50;padding:0}.requirement-close:hover{background:#e8f1ec;text-decoration:none}
.requirement-tabs{display:flex;gap:24px;border-bottom:1px solid #dbe5df;padding:0 28px;flex-shrink:0}
.requirement-tab{font-size:14px;padding:12px 0;border-bottom:3px solid transparent;color:#667970}.requirement-tab[aria-selected=true]{border-color:#176346;color:#176346;font-weight:700}.requirement-tab:hover{text-decoration:none}
.requirement-reading{min-height:0;flex:1;overflow:auto;overscroll-behavior:contain;padding:28px}
.requirement-content{max-width:720px;margin:0 auto;font-size:16px;line-height:1.85;overflow-wrap:anywhere}
.requirement-content p{color:inherit;white-space:pre-line;margin:0 0 18px}.requirement-content h3{font-size:17px;margin:24px 0 10px}.requirement-content h4{font-size:16px;margin:20px 0 8px}.requirement-content ul,.requirement-content ol{padding-left:1.5em;margin:12px 0 22px}.requirement-content li{margin:8px 0}
.requirement-content code{font-size:.88em;background:#f3f6f3;padding:2px 5px;border-radius:4px}.requirement-content pre{white-space:pre-wrap;background:#f3f6f3;border-radius:10px;padding:16px;font-size:13px;line-height:1.7;overflow-wrap:anywhere}
.requirement-content blockquote{margin:16px 0;border-left:3px solid #cddbd2;padding-left:16px;color:#62756d}.requirement-content .document-table{overflow-x:auto;margin:18px 0}.requirement-content table{table-layout:auto;min-width:0;font-size:14px}.requirement-content th,.requirement-content td{width:auto!important;padding:10px;min-width:90px}.requirement-content th{background:#f3f6f3}
.requirement-note{font-size:12px;color:#667970;margin-bottom:22px!important}.requirement-source{border-bottom:1px solid #e2e9e5;padding:16px 0}.requirement-source:first-child{padding-top:0}.requirement-source .case-label{margin-bottom:5px}.requirement-source p{margin-bottom:8px}
button:focus-visible,summary:focus-visible{outline:2px solid #176346;outline-offset:4px}
@media(max-width:600px){.requirement-dialog{margin:0;width:100vw;max-width:none;height:100dvh;max-height:100dvh;border:0;border-radius:0}.requirement-dialog-header{padding:22px 20px 16px}.requirement-dialog h2{font-size:20px}.requirement-tabs{padding:0 20px;gap:20px}.requirement-reading{padding:24px 20px}.requirement-content{font-size:16px}}
'''

from pathlib import Path

_VIEWER = Path(__file__).with_name('viewer')
DIALOG_CSS += (_VIEWER / 'traceability.css').read_text()
DIALOG_HTML = (_VIEWER / 'traceability.html').read_text()
DIALOG_SCRIPT = (_VIEWER / 'traceability.js').read_text()
