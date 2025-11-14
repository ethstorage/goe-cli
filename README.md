# goe-cli

**goe-cli** is a decentralized Git solution designed to manage repositories on-chain. It provides two main components:

1. **Wallet CLI** – manage your blockchain wallets.
2. **Repo CLI** – manage repositories and permissions on-chain.
3. **Git Helper** – integrates with standard Git commands using the `goe://` protocol.

---

## 1. Wallet CLI

The wallet CLI allows you to create, list, and manage wallets. All wallet-based operations require unlocking the wallet first.

### Commands

- **List wallets**
```bash
goe wallet list
```

- **Create a wallet**
```bash
goe wallet create
```

- **Unlock a wallet**
```bash
goe wallet unlock
```

- **Lock a wallet**
```bash
goe wallet lock
```

**🔑 Note: Other wallet-dependent operations require the wallet to be unlocked.**


## 2. Repo CLI

The repo CLI allows you to create repositories, set branches, and manage permissions on-chain.

### Commands


- **List repositories**
```bash
goe repo list --chain-id <chain_id>

# eg.
goe repo list --chain-id  11155111
```


- **Create a repository**
```bash
goe repo create <repo_name> --chain-id <chain_id>

# eg.
goe repo create test-repo --chain-id 11155111
```

- **Set default branch**
```bash
goe repo default-branch <repo_address> <branch_name> --chain-id <chain_id>

# eg.
goe repo default-branch 0x0533dc9CD8...aF4279Bda20f55 master --chain-id 11155111
```


- **Grant push access**
```bash
goe repo grant-push <repo_address> <puser_address> --chain-id <chain_id>

# eg.
goe repo grant-push 0x0533dc9CD84D...dfaF4279Bda20f55 0x1234... --chain-id 11155111
```

- **Revoke push access**
```bash
goe repo revoke-push <repo_address> <puser_address> --chain-id <chain_id>

# eg.
goe repo revoke-push 0x0533dc9CD84D...dfaF4279Bda20f55 0x1234... --chain-id 11155111
```

---


## 3. Git Helper

The second CLI serves as a Git helper, allowing you to interact with decentralized Git repositories using standard Git commands.

### Protocol

Repositories are accessed via the **goe://** protocol:

```bash
goe://<repo_address>:<chain_id>
```

### Example:

```bash
goe://0x08EdC3E3e8A2882B08CC92afeC9Dc0695EC99a43:11155111
```

This helper supports conventional Git commands while syncing with the on-chain repository.

---

## Getting Started

### Install the CLI:

```bash
npm install -g goe-cli
```
