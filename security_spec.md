# Firestore Security Specification: Curator Prime

## 1. Data Invariants
- **Identity Integrity**: Every `CollectionItem` must be tethered to a `userId` that strictly matches the creator's `request.auth.uid`.
- **Immutability**: Once an item is vaulted, its `id` and `userId` are immutable.
- **Relational Access**: Users can only interact with documents they own (`resource.data.userId == request.auth.uid`).
- **Verified Status**: All write operations require a verified email (`request.auth.token.email_verified == true`).
- **Input Sanitization**: Strings are capped at reasonable sizes (e.g., descriptions < 2000 chars) to prevent resource exhaustion attacks.

## 2. The "Dirty Dozen" Payloads (Red Team Test Cases)

| ID | Description | Victim Field | Malicious Action | Expected |
|:---|:---|:---|:---|:---|
| 1 | **Identity Spoofing** | `userId` | Create item with `victim_uid`. | DENIED |
| 2 | **Privilege Escalation** | `userId` | Update `userId` to match another user. | DENIED |
| 3 | **Anonymous Sabotage** | - | Write without being signed in. | DENIED |
| 4 | **Unverified Injection** | - | Write with `email_verified: false`. | DENIED |
| 5 | **Resource Exhaustion** | `itemName` | Insert 2MB string into `itemName`. | DENIED |
| 6 | **Out-of-Bounds Score** | `conditionScore` | Set `conditionScore` to 11 (max 10). | DENIED |
| 7 | **Negative Valuation** | `valuation.low` | Set `valuation.low` to -100. | DENIED |
| 8 | **State Poisoning** | `provenance.chainStatus` | Set `chainStatus` to "Hacked". | DENIED |
| 9 | **Blanket Exposure** | - | Unauthorized `list` query (no UID filter). | DENIED |
| 10 | **Orphaned Document** | `id` | Create item at `items/id1` with `body.id: "id2"`.| DENIED |
| 11 | **Path Traversal** | Document ID | Use `../admin/config` as `itemId`. | DENIED |
| 12 | **Ghost Field Injection** | - | Add `isVerified: true` to a standard update. | DENIED |

## 3. Test Runner Schema (Mock Implementation)
The following is a conceptual representation of the test suite that would verify these invariants.

```typescript
// firestore.rules.test.ts
import { assertSucceeds, assertFails, initializeTestEnvironment } from '@firebase/rules-unit-testing';

describe("Curator Prime Security Rules", () => {
    // 1. Identity Spoofing Test
    it("should deny creating an item for another user", async () => {
        const db = testEnv.authenticatedContext('attacker_uid', { email_verified: true });
        await assertFails(db.collection('items').doc('item1').set({
            userId: 'victim_uid',
            itemName: 'Stolen Asset',
            // ... other valid fields
        }));
    });

    // 2. Unverified Email Test
    it("should deny writes from unverified accounts", async () => {
        const db = testEnv.authenticatedContext('user1', { email_verified: false });
        await assertFails(db.collection('items').add({ itemName: 'New Item' }));
    });
    
    // ... Additional tests covering all 12 payloads
});
```
