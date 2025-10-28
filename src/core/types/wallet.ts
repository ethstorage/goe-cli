export interface EncryptedWalletFile {
    address: string;
    encryptedPrivateKey: string; // AES encrypted private key (format: salt:iv:authTag:ciphertext)
    type: 'privateKey' | 'mnemonic'; // wallet type
    createdAt: string;
}

export interface DecryptedWallet {
    address: string;
    privateKey: string; // Plaintext private key (cleared immediately after use)
    type: 'privateKey' | 'mnemonic';
}
