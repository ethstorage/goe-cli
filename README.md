# GoE — Git on Ethereum

GoE is a decentralized Git protocol built on Ethereum and EthStorage, providing a new standard for trustworthy, on-chain
code hosting.

It redefines code ownership and verifiability, making your repositories **secure, censorship-resistant, and permanently
accessible — just like blockchain assets.**

With GoE, your code is:
- **Censorship-resistant** — leveraging Ethereum’s permissionless network and global consensus for truly open
  collaboration.
- **Immutable and traceable** — GoE stores Git repository state fully on-chain: smart contracts track branch heads and
  the metadata of Git objects, while the actual repository data is stored in EthStorage. Together, they provide a
  tamper-proof, verifiable history.
- **Web3-native** — fully compatible with Ethereum wallets, DAOs, DApps, and identity systems.
- **Fully usable** — no new blockchain or extra node infrastructure required.
- **Git-native** — seamless compatibility with standard Git commands via the `goe://` protocol.

---

## How GoE Works

GoE uses a three-layer model for seamless Git integration:

1. **Git Remote Helper** — handles the `goe://` protocol for all Git commands.
2. **[Ethereum Smart Contracts](https://github.com/ethstorage/goe-contracts)** — manage branches, commits, and access permissions on-chain.
3. **EthStorage (EIP-4844 Blob)** — stores large Git data objects efficiently on Ethereum L2.

📘 **Design Document:**  
For a deeper technical overview of GoE's architecture and on-chain Git mechanics, see our [design doc](https://github.com/ethstorage/ethfs-git/pull/1/files).

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

> ⚠️ **Note for Linux Users:**  
> GoE CLI currently supports macOS and Windows. Linux support is still in progress, as the CLI relies on keytar for
> secure key storage, which is not yet working reliably on Linux. We’re actively working on adding full Linux support.

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

> 🔑 **Note:** Wallets are secured using a password-derived key stored in your system keychain.
> - **Unlock**: Enter your password to derive a key and store it in the system keychain to decrypt your private key for Git operations.
> - **Lock**: Remove the derived key from the system keychain to secure your wallet.


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

- **List branches**
```bash
goe repo branches <repo_address> --chain-id <chain_id>
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

# Output:
# Repo address: 0xABCDEF...

# 3. Use normal git operations to create the first commit and push it on-chain
git init
git remote add origin goe://0xABCDEF...:11155111

echo "# My Project" > README.md
git add .
git commit -m "Initial commit"

# The first push creates the branch on-chain (e.g. master),
# and this branch becomes the default branch automatically.
git push origin master

# 4. Set the default branch
# Only needed if you want to change it later.
goe repo default-branch <repo_address> master --chain-id 11155111

# 5. Grant collaborator push access
goe repo grant-push <repo_address> <collaborator_address> --chain-id 11155111
```

## Additional Reference

For a practical guide with example commands and workflows, see **[test-guide.md](./TEST_GUIDE.md)**.


## Notes
- GoE is fully compatible with existing Git workflows.

- All commits and repository history are verifiable on-chain.

- “Not your keys, not your code.”


