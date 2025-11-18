# GOE — Decentralized Git: Test Guide

This document explains how to install and test GOE, a decentralized Git system (“Git-On-Ethereum”). It walks you through
wallet setup, repo creation, Git operations, and how to migrate an existing GitHub repository to GOE.

## 1. Tool Preparation
Install GOE CLI
``` 
npm install -g goe-cli
```

## 2. Wallet Setup
GOE requires an on-chain identity and gas for storing Git data on Ethereum.

### 2.1 Create a Wallet
``` 
goe wallet create
```

This command generates a new wallet and displays its **address** and **private key**.
(Currently only one wallet is supported.)

➡️ **Make sure to transfer some ETH** to this wallet so you can run the upcoming tests.


### 2.2 View the Wallet Address
``` 
goe wallet list
``` 

##  3. Create a Repository on GOE

A decentralized repo is deployed as a smart contract.

### 3.1 Create a New Repo
``` 
goe repo create <repo_name> --chain-id <chain_id>
``` 

Example:
``` 
goe repo create test-repo --chain-id 11155111
``` 


### 3.2 List Repos You Created
``` 
goe repo list --chain-id <chain_id>
``` 

Example:
``` 
goe repo list --chain-id 11155111
``` 


## 4. Git Operations via GOE

GOE uses a custom Git protocol:

``` 
goe://[contract_address]:[chain_id]
``` 

Example:
``` 
goe://0x3BB6F5b45649E9793Ecad8C909502566398CDb4C:11155111
``` 


### There are multiple ways to link your Git repo to GOE.

### 4.1 Clone a Repo Hosted on GOE
``` 
git clone goe://0x3BB6F5b45649E9793Ecad8C909502566398CDb4C:11155111
``` 

### 4.2 Link a New Local Git Repository to GOE

If you already ran git init:
``` 
git remote add origin goe://0x3BB6F5b45649E9793Ecad8C909502566398CDb4C:11155111
``` 

### 4.3 Switch an Existing Repository’s Remote to GOE

If you cloned from GitHub, GitLab, etc.:
``` 
git remote set-url origin goe://0x3BB6F5b45649E9793Ecad8C909502566398CDb4C:11155111
``` 

### 4.4 Use Git Normally

Once the remote is configured, you can perform standard Git operations:
``` 
echo "test data" > test.txt
git add test.txt
git commit -m "add test.txt"
git push -u origin master
git pull
``` 

Everything works the same — storage is simply on Ethereum instead of a centralized server.

## 5. Example: Vitalik’s Blog Repo on GOE

Repo address:
``` 
goe://0x56f87B828CCe0943e00CCf763e63688Aba4ae834:11155111
``` 

Clone it:
``` 
git clone goe://0x56f87B828CCe0943e00CCf763e63688Aba4ae834:11155111 blog
``` 

## 6. Migrating a GitHub Project to GOE

This is a common workflow — take an existing GitHub repo and move it fully on-chain.

### Step 1 — Deploy a GOE Repo (Smart Contract)
``` 
goe repo create my-project --chain-id 11155111
``` 

Copy the output contract address, for example:
``` 
0xABCDEF1234...
``` 

### Step 2 — Open Your GitHub Project Locally
``` 
cd my-github-project
``` 

### Step 3 — Replace the Origin Remote with GOE
``` 
git remote set-url origin goe://0xABCDEF1234:11155111
``` 

### Step 4 — Push Everything On-Chain
``` 
git push -u origin master
``` 

From this point forward, your project is fully decentralized and stored on Ethereum via GOE.
