# GoE — Git on Ethereum

GoE is a decentralized Git protocol built on Ethereum and EthStorage, providing a new standard for trustworthy, on-chain code hosting.  
It redefines code ownership and verifiability, making your repositories free, secure, and permanently accessible, like Bitcoin.


With GoE, your code is:
- **Censorship-resistant** — leveraging Ethereum’s permissionless network and global consensus for truly open collaboration.
- **Immutable and traceable** — all commits and history are stored on-chain, verifiable for the long term.
- **Web3-native** — fully compatible with Ethereum wallets, DAOs, DApps, and identity systems.
- **Fully usable** — no new blockchain or extra node infrastructure required.
- **Git-native** — seamless compatibility with standard Git commands via the `goe://` protocol.

---

## How GoE Works

GoE uses a three-layer model for seamless Git integration:

1. **Git Remote Helper** — handles the `goe://` protocol for all Git commands.
2. **Ethereum Smart Contracts** — manage branches, commits, and access permissions on-chain.
3. **EthStorage (EIP-4844 Blob)** — stores large Git packfiles efficiently on Ethereum L2.

---

## `goe://` Protocol

GoE introduces a custom Git protocol to access on-chain repositories.

```bash
goe://<repo_address>:<chain_id>
```

- `<repo_address>` — the smart contract address of the repository
- `<chain_id>` — the chain ID where the repository is deployed

> This protocol is automatically handled by the Git Helper installed with `goe-cli`. No additional setup is required.

---



## Getting Started

### Install the CLI
```bash
npm install -g goe-cli
```

## 1. Wallet Command

Manage wallets that act as your on-chain identity.

- **Create a wallet**
```bash
goe wallet create
```

- **List wallets**
```bash
goe wallet list
```

- **Unlock a wallet**
```bash
goe wallet unlock
```

- **Lock a wallet**
```bash
goe wallet lock
```

> 🔑 Note: Unlock your wallet to perform wallet-dependent operations, and lock it when finished for security.


## 2. Repo Command

Create and manage on-chain repositories and permissions.

- **Create a repository**
```bash
goe repo create <repo_name> --chain-id <chain_id>
```

- **List repositories**
```bash
goe repo list --chain-id <chain_id>
```

- **Set default branch**
```bash
goe repo default-branch <repo_address> <branch_name> --chain-id <chain_id>
```

- **Grant / Revoke push access**
```bash
goe repo grant-push <repo_address> <user_address> --chain-id <chain_id>
goe repo revoke-push <repo_address> <user_address> --chain-id <chain_id>
```


## Example Workflow

```bash
# 1. Create or unlock your wallet
goe wallet create
goe wallet unlock

# 2. Create a new repository on Sepolia
goe repo create my-project --chain-id 11155111

# 3. Set the default branch
goe repo default-branch <repo_address> master --chain-id 11155111

# 4. Grant collaborator push access
goe repo grant-push <repo_address> <collaborator_address> --chain-id 11155111
```

## Notes
- GoE is fully compatible with existing Git workflows.

- All commits and repository history are verifiable on-chain.

- “Not your keys, not your code.”


