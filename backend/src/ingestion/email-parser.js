'use strict';

const fs = require('fs');
const path = require('path');
const { simpleParser } = require('mailparser');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const RE_FWD_PATTERN = /^\s*(re|fwd?|fw|aw|sv|vs|antw|wg|rép|réf|ref|enc)\s*(\[\d+\])?\s*:\s*/gi;

// ---------------------------------------------------------------------------
// Internal Helpers
// ---------------------------------------------------------------------------

/**
 * Normalize an email address object or string into "Name <email@domain.com>" format.
 * @param {Object|string} addr
 * @returns {string}
 */
function normalizeAddress(addr) {
    if (!addr) return '';
    if (typeof addr === 'string') return addr.trim();
    const name = addr.name ? addr.name.trim() : '';
    const email = addr.address ? addr.address.trim().toLowerCase() : '';
    return name ? `${name} <${email}>` : email;
}

/**
 * Normalize an AddressObject (mailparser format) to a flat array of strings.
 * @param {Object|Array|undefined} addrObj
 * @returns {string[]}
 */
function normalizeAddressList(addrObj) {
    if (!addrObj) return [];
    const list = Array.isArray(addrObj.value)
        ? addrObj.value
        : addrObj.value
        ? [addrObj.value]
        : [];
    return list.map(normalizeAddress).filter(Boolean);
}

/**
 * Parse a comma/semicolon-separated references or message-id header string
 * into a clean array of IDs.
 * @param {string|undefined} raw
 * @returns {string[]}
 */
function parseReferences(raw) {
    if (!raw) return [];
    return raw
        .split(/[\s,]+/)
        .map(r => r.trim())
        .filter(r => r.startsWith('<') && r.endsWith('>'));
}

/**
 * Strip Re:/Fwd: prefixes from a subject line.
 * @param {string} subject
 * @returns {string}
 */
function normalizeSubject(subject) {
    if (!subject) return '';
    return subject.replace(RE_FWD_PATTERN, '').trim();
}

/**
 * Produce a canonical sorted participant set string for thread grouping.
 * @param {string} from
 * @param {string[]} to
 * @param {string[]} cc
 * @returns {string}
 */
function participantKey(from, to, cc) {
    const extractEmail = addr => {
        const match = addr.match(/<([^>]+)>/);
        return match ? match[1].toLowerCase() : addr.toLowerCase();
    };
    const all = [from, ...to, ...cc].map(extractEmail);
    return [...new Set(all)].sort().join('|');
}

// ---------------------------------------------------------------------------
// Core Parse Function
// ---------------------------------------------------------------------------

/**
 * Parse a single EML file and return a standardized email object.
 *
 * @param {string} filePath  Absolute path to the .eml file
 * @returns {Promise<{
 *   messageId: string,
 *   from: string,
 *   to: string[],
 *   cc: string[],
 *   subject: string,
 *   date: string,
 *   body: string,
 *   htmlBody: string,
 *   attachments: Array<{filename: string, contentType: string, size: number}>,
 *   inReplyTo: string,
 *   references: string[]
 * }>}
 */
async function parseEmailFile(filePath) {
    const resolvedPath = path.resolve(filePath);

    if (!fs.existsSync(resolvedPath)) {
        throw new Error(`Email file not found: ${resolvedPath}`);
    }

    const rawContent = fs.readFileSync(resolvedPath);

    let parsed;
    try {
        parsed = await simpleParser(rawContent);
    } catch (err) {
        throw new Error(`Failed to parse email file ${path.basename(filePath)}: ${err.message}`);
    }

    const fromAddr = parsed.from?.value?.[0];
    const from = normalizeAddress(fromAddr);
    const to = normalizeAddressList(parsed.to);
    const cc = normalizeAddressList(parsed.cc);

    const attachments = (parsed.attachments || []).map(att => ({
        filename: att.filename || 'unnamed',
        contentType: att.contentType || 'application/octet-stream',
        size: att.size || (att.content ? att.content.length : 0),
        contentId: att.cid || null,
    }));

    return {
        messageId: parsed.messageId || null,
        from,
        to,
        cc,
        subject: parsed.subject || '',
        date: parsed.date ? parsed.date.toISOString() : null,
        body: parsed.text || '',
        htmlBody: parsed.html || '',
        attachments,
        inReplyTo: parsed.inReplyTo || null,
        references: parseReferences(
            Array.isArray(parsed.references)
                ? parsed.references.join(' ')
                : parsed.references || ''
        ),
    };
}

// ---------------------------------------------------------------------------
// Archive Parser
// ---------------------------------------------------------------------------

/**
 * Parse one or more EML files from a directory or an array of file paths.
 *
 * @param {string|string[]} input  A directory path, or an array of .eml file paths
 * @returns {Promise<Array>}
 */
async function parseEmailArchive(input) {
    let filePaths = [];

    if (Array.isArray(input)) {
        filePaths = input;
    } else if (typeof input === 'string') {
        const resolved = path.resolve(input);
        const stat = fs.statSync(resolved);
        if (stat.isDirectory()) {
            filePaths = fs
                .readdirSync(resolved)
                .filter(f => /\.(eml|msg)$/i.test(f))
                .map(f => path.join(resolved, f));
        } else {
            filePaths = [resolved]; // single file
        }
    } else {
        throw new TypeError('parseEmailArchive expects a file path, directory path, or array of file paths.');
    }

    if (filePaths.length === 0) {
        return [];
    }

    const results = [];
    const errors = [];

    for (const fp of filePaths) {
        try {
            const email = await parseEmailFile(fp);
            results.push(email);
        } catch (err) {
            errors.push({ file: path.basename(fp), error: err.message });
        }
    }

    if (errors.length > 0) {
        console.warn('[email-parser] Some files could not be parsed:', errors);
    }

    return results;
}

// ---------------------------------------------------------------------------
// Thread Builder
// ---------------------------------------------------------------------------

/**
 * Group an array of parsed email objects into conversation threads.
 *
 * Thread identity is determined by:
 *   1. Explicit In-Reply-To / References headers (most reliable)
 *   2. Normalized subject + participant set (fallback for mail clients that strip headers)
 *
 * Each thread is sorted internally by date (ascending).
 * The returned array is also sorted by thread start date (ascending).
 *
 * @param {Array} emails  Array of objects returned by parseEmailArchive
 * @returns {Array<{
 *   threadId: string,
 *   subject: string,
 *   participants: string[],
 *   startDate: string,
 *   lastDate: string,
 *   messageCount: number,
 *   messages: Array
 * }>}
 */
function buildEmailThreads(emails) {
    if (!Array.isArray(emails) || emails.length === 0) return [];

    // Build a lookup by messageId for quick reference-chain resolution
    const byMessageId = new Map();
    for (const email of emails) {
        if (email.messageId) {
            byMessageId.set(email.messageId, email);
        }
    }

    // threadId → array of emails
    const threads = new Map();

    // email → threadId mapping
    const emailToThread = new Map();

    /**
     * Find the root threadId for an email via reference chain traversal.
     */
    function findThreadRoot(email) {
        const chain = [email.inReplyTo, ...(email.references || [])].filter(Boolean);
        for (const ref of chain) {
            if (emailToThread.has(ref)) {
                return emailToThread.get(ref);
            }
        }
        return null;
    }

    for (const email of emails) {
        // --- Strategy 1: Use In-Reply-To / References chain ---
        let threadId = findThreadRoot(email);

        if (!threadId) {
            // --- Strategy 2: Subject + participants fingerprint ---
            const normSubject = normalizeSubject(email.subject);
            const pKey = participantKey(email.from, email.to, email.cc);
            const fingerprint = `${normSubject}::${pKey}`;

            // Check if any existing thread matches this fingerprint
            let found = false;
            for (const [tid, msgs] of threads.entries()) {
                const rep = msgs[0];
                const repFingerprint = `${normalizeSubject(rep.subject)}::${participantKey(rep.from, rep.to, rep.cc)}`;
                if (repFingerprint === fingerprint) {
                    threadId = tid;
                    found = true;
                    break;
                }
            }

            if (!found) {
                // New thread
                threadId = email.messageId || `thread-${threads.size + 1}-${Date.now()}`;
            }
        }

        // Register this email's messageId → threadId
        if (email.messageId) {
            emailToThread.set(email.messageId, threadId);
        }

        if (!threads.has(threadId)) {
            threads.set(threadId, []);
        }
        threads.get(threadId).push(email);
    }

    // Build output array
    const result = [];
    for (const [threadId, messages] of threads.entries()) {
        // Sort messages within thread by date ascending
        messages.sort((a, b) => {
            if (!a.date) return 1;
            if (!b.date) return -1;
            return new Date(a.date) - new Date(b.date);
        });

        // Collect all unique participants in the thread
        const participantSet = new Set();
        for (const msg of messages) {
            if (msg.from) participantSet.add(msg.from);
            msg.to.forEach(a => participantSet.add(a));
            msg.cc.forEach(a => participantSet.add(a));
        }

        result.push({
            threadId,
            subject: normalizeSubject(messages[0].subject),
            participants: [...participantSet],
            startDate: messages[0].date || null,
            lastDate: messages[messages.length - 1].date || null,
            messageCount: messages.length,
            messages,
        });
    }

    // Sort threads by start date ascending
    result.sort((a, b) => {
        if (!a.startDate) return 1;
        if (!b.startDate) return -1;
        return new Date(a.startDate) - new Date(b.startDate);
    });

    return result;
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
    parseEmailArchive,
    buildEmailThreads,
    // parseEmailFile is exported separately for single-file use in the bulk test runner
    parseEmail: parseEmailFile,
};
