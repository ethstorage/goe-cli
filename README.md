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

GoE repositories are identified on-chain by their contract addresses. The goe:// protocol lets you reference a repository in three ways:

| URI Format                                 | Type      | Resolution Logic                                     |
|--------------------------------------------|-----------|------------------------------------------------------|
| ```goe://<repo_address>:<chain_id>```      | Canonical | Direct access via on-chain contract address          | 
| ```goe://<repo_name>:<chain_id>```         | Shorthand | Resolves via the current wallet and repository name  | 
| ```goe://<owner>/<repo_name>:<chain_id>``` | Full Path | Resolves via any owner’s address and repository name | 

> **Note:** `<repo_address>` refers to the repository's smart contract; `<chain_id>` is the blockchain network ID.

---



## Getting Started

### 1. Install the CLI
```bash
npm install -g goe-cli
```

### 2. Global Configuration
Some GoE CLI parameters can be provided either as command-line flags or via environment variables.

#### Chain ID
Most `goe repo` commands require a target chain ID. You can specify it in one of the following ways:

- **Command-line flag** (highest priority):
```bash
goe repo create my-repo --chain-id 11155111
```

- **Environment variable** (applies to all commands in the current shell):
```bash
export GOE_CHAIN_ID=11155111
goe repo create my-repo
```

If both are provided, the command-line flag overrides the environment variable.

### 3. Wallet Command

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

### 4. Repo Command

> All goe repo commands work with repositories owned by the current wallet. You can refer to a repository either by its
> name or by its contract address.

- **Create a repository**
```bash
goe repo create <repo_name> [--chain-id <chain_id>]
```
> If --chain-id is not provided, GoE will use the GOE_CHAIN_ID environment variable.


- **List repositories**
```bash
goe repo list [--chain-id <chain_id>]
```

- **List branches**
```bash
goe repo branches <repo_address|repo_name> [--chain-id <chain_id>]
```

- **Set default branch**
```bash
goe repo default-branch <repo_address|repo_name> <branch_name> [--chain-id <chain_id>]
```

- **Grant / Revoke push access**
```bash
goe repo grant-push <repo_address|repo_name> <user_address> [--chain-id <chain_id>]
goe repo revoke-push <repo_address|repo_name> <user_address> [--chain-id <chain_id>]
```

### 5. Example Workflow

#### 1). Create or unlock your wallet
```bash
goe wallet create
goe wallet unlock
```

#### 2). Create a new repository on Sepolia
```bash
goe repo create my-project --chain-id 11155111

# Output:
# Repo address: 0xABCDEF...
```

#### 3). Use normal git operations to create the first commit
```bash
git init
git remote add origin goe://0xABCDEF...:11155111

echo "# My Project" > README.md
git add .
git commit -m "Initial commit"
```

#### 4). Push changes on-chain (optionally increase gas)
```bash
# The first push creates the branch on-chain (e.g. master),
# and this branch becomes the default branch automatically.
git push origin master
```

**⚠️ Optional:** If the push transaction is slow to confirm or becomes stuck, you can temporarily increase the gas price by setting the `GOE_GAS_INC_PCT` environment variable.

Examples:
- 0 → default gas (no increase)
- 1 → +1% gas
- 100 → +100% gas (double the base gas)

```bash
# Increase gas by 10%
GOE_GAS_INC_PCT=10 git push -u origin main
```

#### 5). Set the default branch
```bash
# Only needed if you want to change it later.
goe repo default-branch <repo_address|repo_name> master --chain-id 11155111
```

#### 6). Grant collaborator push access
```bash
goe repo grant-push <repo_address|repo_name> <collaborator_address> --chain-id 11155111
```


## Additional Reference

For a practical guide with example commands and workflows, see **[test-guide.md](./TEST_GUIDE.md)**.


## Notes
- GoE is fully compatible with existing Git workflows.

- All commits and repository history are verifiable on-chain.

- “Not your keys, not your code.”


