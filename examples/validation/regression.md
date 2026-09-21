# Regression probes — 上一任冠军必须保持的行为

> 每行一条探针：`- <name>: <可执行的检查>`。每回合选优后对新候选重跑，
> 任一失败 → 该候选标记 regressionFailed，需人复核。

- fact-check: 通读候选，确认没有引入与 baseline 相反的事实（如把"人工智能"写成"人力智能"）。
- smoke: 候选目录内 README.md 与 CHANGELOG.md 都存在且非空。
