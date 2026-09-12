# 实验性 Verifier Bundle

[English](README.md) | 中文

`@deepseek-ai/dsh-experimental-verifier-bundle` 是私有、选择加入的 DSH profile bundle。它在所选 profile 中安装实验性 verifier service 和显式 `verify_pair` 工具。它不属于 base、headless 或 Web bundle。

## Installation

在已经构建该 bundle 的 source checkout 中，通过 profile package manager 安装：

```sh
PATH="/home/linuxbrew/.linuxbrew/bin:$PATH" pnpm dsh plugin --profile web add ./packages/bundle/experimental-verifier
```

profile-local dependency graph 使 `dsh-web.service` 能够解析这两个私有实验性 package。不要把 bundle patch row 直接复制到 profile `cordis.patch.yml`。

重启前验证：

```sh
PATH="/home/linuxbrew/.linuxbrew/bin:$PATH" pnpm dsh --profile web --dump-config
```

通过相同接口移除 bundle：

```sh
PATH="/home/linuxbrew/.linuxbrew/bin:$PATH" pnpm dsh plugin --profile web remove @deepseek-ai/dsh-experimental-verifier-bundle
```

## Model Experience

### Indirect verifier tool

#### What the model sees

该 bundle 只通过 verifier dependency 添加 `verify_pair` 工具。service 和 tool package 的 README 定义其 schema 与 result。

#### Token effect

bundle 本身不会增加 request。每次显式 `verify_pair` 调用会产生一个有界 external verifier request。

#### KV Cache effect

bundle 不增加 prompt section 或 durable context。正常的 tool call 和 result record 仍是 replay source。

## Known Limitations and Deferred Work

- **私有 source bundle**——它面向 source checkout，不作为 release package 发布。
- **不自动 verification**——bundle 只暴露显式 `verify_pair`，不会改变 agent-loop 或 goal behavior。
- **不具备正确性权威**——仍然需要 deterministic evidence 和 human review。
