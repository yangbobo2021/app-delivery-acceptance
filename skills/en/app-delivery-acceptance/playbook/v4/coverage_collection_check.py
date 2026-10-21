"""Classify observed collector lifecycle errors; never calculate coverage units."""
import re

def check_collection(log, receipt_sha256):
    text=re.sub(r'\x1b\[[0-9;]*m','',log)
    gaps=[]
    if re.search(r'worker-\d+ process did not exit .*force-killed',text):
        gaps.append('测试工作进程未正常退出并被框架强制结束；已保存计数真实，但最终收尾无法确认完整。')
    if 'COVERAGE_COLLECTOR_GAP:' in text:
        gaps.append('采集适配器报告了未完成的最终快照；保留真实计数并明确缺口。')
    if re.search(r'Fixture ["\'](?:browser|coverageRuntime)["\'] timeout[\s\S]{0,100}during teardown',text):
        gaps.append('Playwright 覆盖率夹具收尾超时；保留的原始快照真实，但不能保证最后一段执行已完整保存。')
    if 'Error:' in text and re.search(r'at (?:save|flush) [^\n]*coverage-runtime/node-hook\.cjs',text):
        gaps.append('运行日志记录了覆盖率保存适配器错误；不能把缺失计数当作零命中。')
    return {'schema':'coverage-collection-lifecycle-v1','status':'incomplete' if gaps else 'no_observed_collector_error',
            'execution_sha256':receipt_sha256,'limitations':gaps,
            'meaning':'只检查实际记录的采集错误，不因用例失败、接受风险或证据不足而排除真实计数。'}
