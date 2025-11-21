# GoE (Git on Ethereum) — Test Guide

This guide helps you quickly get started with GoE, a decentralized Git system on Ethereum and EthStorage.

It covers wallet setup, repository creation, interacting with a sample repo, and migrating an existing GitHub project to
GoE.

GoE enables fully on-chain Git workflows: repositories are stored on Ethereum and EthStorage, immutable, and censorship-resistant.

> Prerequisite: You need a wallet with some ETH to pay gas fees for repository operations.

---

## 1. Setup: Tools, Wallets, and Repositories

### 1.1 Install GoE

```bash
npm install -g goe-cli
```

### 1.2 Wallet Setup

- Create a wallet

```bash
goe wallet create
```

> ➡️ **Transfer some ETH** to this wallet so you can perform on-chain operations.

- List wallets

```bash
goe wallet list
```

> 🔑 Tip: After you finish using the wallet, lock it for security using **'goe wallet lock'**.

### 1.3 Create a New Repository

```bash
goe repo create <repo_name> --chain-id <chain_id>

# Example:
goe repo create test-repo --chain-id 11155111
# Output:
# Repo address: 0x3BB6F5b45649E9793Ecad8C909502566398CDb4C
``` 

- List your repositories:

```bash
goe repo list --chain-id <chain_id>

# Example:
goe repo list --chain-id 11155111
``` 

### 1.4 Link Local Git Repository

- For a new local repo:

```bash
git init
git remote add origin goe://<repo_address>:<chain_id>

# Example:
git remote add origin goe://0x3BB6F5b45649E9793Ecad8C909502566398CDb4C:11155111
```

- For an existing repository:

```bash
git remote set-url origin goe://<repo_address>:<chain_id>

# Example:
git remote set-url origin goe://0x3BB6F5b45649E9793Ecad8C909502566398CDb4C:11155111
``` 

- Standard Git operations:

```bash
git add .
git commit -m "Initial commit"
git push -u origin main
``` 

## 2. Working with an Existing GoE Repository

Example: Vitalik’s Blog Repository

- Clone the repository:

```bash
git clone goe://0x56f87B828CCe0943e00CCf763e63688Aba4ae834:11155111 blog
``` 

By default, your wallet address does **not** have push access to this repository.

If you want to modify this repository, please send your wallet address to us (for example, via the Issues page on this
GitHub project), so we can grant you push permission.

- Once granted, you can commit and push as usual:

```bash
git add file.txt
git commit -m "Add new file"
git push
``` 

> ⚠️ Performance Notes (for reference only):
>
> - Repository size: 145.7 MB
> - Upload time via GoE: 3h 25m
> - Download time via Git Helper (12 packfiles): 7.86 min
> - Download time via regular Git HTTP clone: 4 min
> - Cost to upload on Sepolia testnet: < 0.7 ETH (approximate)
> - Bottleneck: Upload speed is dominated by blockchain transaction throughput and confirmation times, unlike centralized Git hosting.



## 3. Migrating an Existing GitHub Project to GoE

### Step 1 — Deploy a GoE Repo (Smart Contract)

```bash
goe repo create my-project --chain-id 11155111
``` 

Copy the output contract address, for example:

```bash
0xABCDEF...1234
``` 

### Step 2 — Open Your GitHub Project Locally

```bash
cd my-github-project
``` 

### Step 3 — Replace the Origin Remote with GoE

```bash
git remote set-url origin goe://0xABCDEF...1234:11155111
``` 

### Step 4 — Push Everything On-Chain

```bash
git push -u origin main
``` 

From this point forward, your project is fully decentralized on Ethereum via GoE.
