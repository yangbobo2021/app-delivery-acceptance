输出：{"requirement_id":"目标ID","scenarios_sha256":"实际输入哈希","status":"approved|changes_required|needs_clarification","summary":"一句总体结论","checks":{"coverage":"sufficient|gap","priority":"appropriate|gap","overlap":"clear|overlap","scope":"related|gap"},"coverage":[{"requirement_quote":"足以定位重要原文条款的连续短片段","scenario_ids":["对应ID，确实未覆盖则为空"]}],"passed_scene_ids":["等级、目的和关联合理的场景ID"],"findings":[{"id":"F1","kind":"coverage|priority|overlap|scope|clarification","scenario_ids":["涉及的现有ID，可为空"],"requirement_quote":"连续原文片段或用户明确限制","reason":"简明具体问题；覆盖问题说明会逃过当前场景的错误条件","requested_change":"必要修正"}]}。

完整比较原文重要情况及所有场景；覆盖表仅列短原文和对应ID，不写通过理由。通过场景仅列ID，不写等级/关联判断的逐项解释。问题集中写一次，不在summary和覆盖映射重复长段。coverage缺漏可以引用仍然等级合理的通过场景；但等级、重叠、范围有问题的场景不能列入passed_scene_ids。每个现有场景都必须在通过ID或问题引用中出现。多个问题可以涉及同一场景。

approved必须四项checks通过、全部现有ID在passed_scene_ids且findings为空。有问题就changes_required并给具体发现；真正缺少业务决策才needs_clarification。不因句子短放过缺少条件或预期，也不要求场景提前写用例步骤/证据采集。共享前置不自动构成重复；独立目的可保留。重要度不按数量/比例决定，已确认范围保持不变。
