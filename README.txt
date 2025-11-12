# ERC1155C On-Chain Issuance (Polygon Amoy Testnet)

## 📖 Overview
This repository demonstrates the **On-Chain Issuance Framework** for Real Estate Tokenization using **ERC1155C (Compliance Extension)**.  
It extends ERC1155 by embedding compliance and governance mechanisms directly into the issuance process, including:

- ✅ Dual Approval (Notary + Fund Manager)
- ✅ Whitelist-based KYC/AML Enforcement
- ✅ Immutable On-Chain Audit Trail
- ✅ Freeze Controls for Risk Management

The framework aligns with **Indonesian regulatory context**, where both **notary validation** and **fund manager oversight** are legally required.

## 🔗 Deployment
- **Contract (Polygon Amoy)**: `0x7c80E676758cc6f1748ddF0c02dB0abE8Ec42631`
- **SPV**: 0x03a44e3a296B65Cc0Ff94B17E872f8CFb93ef5E4
- **Notary**: 0xFF303BC357fAb9E73C840eD0bD3107c89d6D1B5f
- **Manager**: 0x766FF70BF672DA28380cFe7AFaF2168Fb8f7c544
- **Recipient**: 0xb933CCAe8Cef00d60b30A0652ad497FF78437542

## ⚙️ Issuance Workflow
1. **SPV** calls `requestMint(to, id, amount, fees, setUriIfEmpty, docHash, docCid)`  
2. **Notary** validates via `approveByNotary(reqId)`  
3. **Manager** confirms via `approveByManager(reqId)`  
4. **SPV** finalizes issuance via `executeMint(reqId)`  

### Events Logged:
- `MintRequested(reqId, to, id, amount)`  
- `ApprovedByNotary(reqId, by)`  
- `ApprovedByManager(reqId, by)`  
- `MintExecuted(reqId, id, amount, to)`  

## 🧪 Test Result (Polygon Amoy)
- ✅ `setKyc(recipient)` → success (recipient whitelisted)  
- ✅ `requestMint` → success, emitted `MintRequested (reqId=4)`  
- ✅ `approveByNotary` → success  
- ✅ `approveByManager` → success  
- ✅ `executeMint` → success, recipient balance updated  

Final balance:  
```text
balanceOf(Recipient, 1) = 10
```

## 📂 Reference
Full paper: *On-Chain Issuance for Real Estate Tokenization: Dual Approval and Whitelist Compliance in ERC1155C*【220†On-Chain Issuance.pdf】

---
© 2025 Surjo Sastroharjono — ERC1155C Issuance Prototype
