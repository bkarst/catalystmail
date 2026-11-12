// Generated from the OpenAPI document by scripts/api-types.ts. Do not edit.
/* eslint-disable */
export interface paths {
    "/openapi.json": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get the OpenAPI 3.1 document for this API
         * @description Returns the contract every operation is generated from. It is public, so clients and agent harnesses can discover the API before authenticating.
         */
        get: operations["getOpenApiDocument"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/me": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Show who is calling and what they may do
         * @description Returns the user or API key behind this request, its scopes and its workspace. Call it first to learn which operations are available to you. It has no side effects.
         */
        get: operations["getCurrentPrincipal"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/work-queue": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Everything waiting for a person, most urgent first
         * @description One prioritized list across open escalations, emails waiting for approval and saved drafts, unmatched replies, mailboxes in error or paused by a breaker, and (in external agent mode) replies to answer and follow-ups to write (§14.5). Most urgent first, then soonest due, then longest waiting. Each item says why it is here and which tools settle it; `counts` has the totals by kind.
         */
        get: operations["getWorkQueue"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/events/stream": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Follow the workspace’s activity live (server-sent events)
         * @description A `text/event-stream` of the workspace’s activities as they are written (§4.2), for live views. Each event is one Activity in its JSON shape: the event name is its `type` (e.g. `thread.stage_changed`) and the event ID is its `id`. Reconnect with the standard `Last-Event-ID` header to get what you missed first (up to 500 events). A comment line every 25 seconds keeps the connection open. Not an MCP tool.
         */
        get: operations["streamEvents"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/jobs/{jobId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Check on a long-running task
         * @description The status of an asynchronous task by the ID its 202 answer gave: an import (`imp_…`, from commitImport) or a mailbox poll (`prn_…`, from listPollRuns). Poll it until `status` is `succeeded` or `failed`.
         */
        get: operations["getJob"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/search": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Search contacts, companies, threads and campaigns at once
         * @description The ⌘K search: matches names, emails, company domains, thread subjects and snippets, and campaign names, best matches first. Threads appear only for callers with `threads:read`, campaigns only with `campaigns:read`. Use the typed list operations for anything more precise.
         */
        get: operations["searchAll"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/contacts": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List and search contacts
         * @description Returns contacts, newest first, one page at a time. Combine the typed filters for common cases, or pass `filter` for AND/OR conditions on any field including custom fields. Deleted contacts are never returned. Use getContact when you already have an ID.
         */
        get: operations["listContacts"];
        put?: never;
        /**
         * Create a contact
         * @description Creates one contact. The email address is trimmed, lower-cased and verified in the background; the company is linked by email domain when it is known. Fails with `conflict` if the address already exists. Creating a contact sends no email; use enrollContacts for that. For many contacts at once use upsertContacts or an import.
         */
        post: operations["createContact"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/contacts/{contactId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get one contact
         * @description Returns a contact by ID, with its verification and subscription status. For its email history use listContactTimeline; for its conversations use listThreads with `contact_id`.
         */
        get: operations["getContact"];
        put?: never;
        post?: never;
        /**
         * Delete a contact
         * @description Soft-deletes the contact and stops every thread it is in. Its email address becomes free to use again, and suppressions stay in place. To remove the contact's personal data for a privacy request use eraseContact instead.
         */
        delete: operations["deleteContact"];
        options?: never;
        head?: never;
        /**
         * Change fields on a contact
         * @description Changes only the fields you send. Edits take effect for the next email that is composed; emails already composed are not re-rendered. Setting `do_not_contact` stops all future sending to the contact. Changing `email` re-runs verification and fails with `conflict` if the new address already exists.
         */
        patch: operations["updateContact"];
        trace?: never;
    };
    "/contacts/{contactId}/erase": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Erase a contact’s personal data for a privacy request
         * @description Permanently removes the contact’s personal data: its fields, notes, and the text of every email in its threads, which are kept as "Erased contact". Only a hash of the address stays, on the suppression list, so it is never emailed again. This cannot be undone. Use exportContactData first if the person asked for a copy.
         */
        post: operations["eraseContact"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/contacts/bulk-upsert": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Create or update up to 1,000 contacts at once
         * @description Creates contacts whose email is new and, depending on `dedupe_strategy`, leaves alone, fills in or overwrites those that exist. The whole request is checked first: if any row is invalid, nothing is written and every error is reported with its row. Sends no email.
         */
        post: operations["upsertContacts"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/contacts/bulk-actions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Tag, list, assign, verify, suppress, delete or export many contacts
         * @description Applies one action to contacts chosen by `contact_ids` (up to 1,000) or by a `filter` (up to 5,000 matches). Each action takes its own field: `tag_ids`, `list_id`, `owner_user_id`, `lifecycle_stage` or `note`. Contacts the action does not apply to are reported in `skipped`. `delete` stops the contacts’ threads; `suppress` blocks their addresses everywhere.
         */
        post: operations["applyContactBulkAction"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/contacts/{contactId}/merge": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Merge a duplicate contact into this one
         * @description Keeps this contact and folds `merge_contact_id` into it: empty fields are filled from the duplicate (and any listed in `take_from_merged` are taken from it), tags, lists, custom fields, threads and timeline move over, and the duplicate is deleted. Fails with `conflict` if both are in the same campaign.
         */
        post: operations["mergeContacts"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/contacts/{contactId}/timeline": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List a contact’s timeline
         * @description Returns everything that happened with the contact, newest first: emails in every campaign, opens, stage and state changes, goals, escalations, notes and field changes. Narrow it with `category`.
         */
        get: operations["listContactTimeline"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/contacts/{contactId}/notes": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Add a note to a contact’s timeline
         * @description Adds a dated note to the contact’s timeline. Notes are for people; the agent does not see them. For facts the agent may use, set the contact’s `notes` field.
         */
        post: operations["addContactNote"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/contacts/{contactId}/verify": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Verify a contact’s email address now
         * @description Checks the address again (syntax, typos, disposable and role accounts, and whether the domain accepts mail) and stores the result on the contact. It never sends anything to the address. A contact whose address hard-bounced stays `bounced`.
         */
        post: operations["verifyContactEmail"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/contacts/{contactId}/export": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Export everything held about a contact
         * @description Returns the contact with its tags, lists, threads and messages, timeline and suppressions as one JSON document, for a data-access request. It changes nothing.
         */
        get: operations["exportContactData"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/contacts/duplicates": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Find contacts that are probably the same person
         * @description Returns groups of likely duplicates: the same name at the same company, or addresses that differ only by dots or a `+tag`. Exact duplicate emails cannot exist. Merge a group with mergeContacts.
         */
        get: operations["listDuplicateContacts"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/imports": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Upload a CSV file of contacts
         * @description Stores a CSV file (up to 50,000 rows) and returns its headers, sample rows and a suggested column mapping. Nothing is imported yet: check the mapping with previewImport, then commitImport.
         */
        post: operations["createImport"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/imports/{importId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get an import with its progress and errors
         * @description Returns an import: its status, progress while processing, the counts when done, and the row problems for the error report. Poll it after commitImport.
         */
        get: operations["getImport"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/imports/{importId}/preview": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Dry-run an import: what it would create, update and skip
         * @description Applies the mapping and options to the whole file without writing any contact, and counts new, updated, skipped, invalid, suppressed and repeated rows, with the first problems. Saves the mapping on the import. Run it before commitImport.
         */
        post: operations["previewImport"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/imports/{importId}/commit": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Import the contacts in an uploaded file
         * @description Starts writing the contacts in the background and returns at once (202). Poll getImport for progress. Invalid and suppressed rows are skipped and reported; existing contacts follow `dedupe_strategy`. New addresses are verified afterwards. Sends no email. An import can be committed only once.
         */
        post: operations["commitImport"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/companies": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List and search companies
         * @description Returns companies one page at a time, by name unless `sort` says otherwise. Deleted companies are never returned. To list the people at a company use listContacts with `company_id`.
         */
        get: operations["listCompanies"];
        put?: never;
        /**
         * Create a company
         * @description Creates a company. When it has a `domain` that is not a free-mail provider, existing contacts at that domain without a company are linked to it, and so are contacts created later. Fails with `conflict` if another company already has the domain.
         */
        post: operations["createCompany"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/companies/{companyId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get one company
         * @description Returns a company by ID with how many contacts belong to it. Use listContacts with `company_id` for the contacts themselves.
         */
        get: operations["getCompany"];
        put?: never;
        post?: never;
        /**
         * Delete a company
         * @description Soft-deletes the company and unlinks its contacts. The contacts themselves are kept and can still be emailed.
         */
        delete: operations["deleteCompany"];
        options?: never;
        head?: never;
        /**
         * Change fields on a company
         * @description Changes only the fields you send. Changing `domain` links contacts at the new domain that have no company; contacts already linked stay linked. Fails with `conflict` if another company has the domain.
         */
        patch: operations["updateCompany"];
        trace?: never;
    };
    "/tags": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List tags
         * @description Returns the tags defined in the workspace, by name. Use the IDs with listContacts `tag_id` or when setting `tag_ids` on a contact.
         */
        get: operations["listTags"];
        put?: never;
        /**
         * Create a tag
         * @description Creates a tag that can then be put on contacts. Tag names are unique in the workspace; a duplicate name fails with `conflict`.
         */
        post: operations["createTag"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/tags/{tagId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /**
         * Delete a tag
         * @description Deletes the tag and removes it from every contact that carries it. The contacts themselves are not changed otherwise.
         */
        delete: operations["deleteTag"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/lists": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List contact lists and segments
         * @description Returns static lists and dynamic segments, by name, with their current member counts. Use listListMembers or listContacts with `list_id` for the members.
         */
        get: operations["listLists"];
        put?: never;
        /**
         * Create a static list or a dynamic segment
         * @description Creates a list. A static list holds the contacts you add (optionally `contact_ids` straight away). A dynamic list is a saved `filter` whose members are worked out each time it is read. Check a filter first with previewSegment.
         */
        post: operations["createList"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/lists/{listId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get one list
         * @description Returns a list with its filter (for a segment) and its current member count.
         */
        get: operations["getList"];
        put?: never;
        post?: never;
        /**
         * Delete a list
         * @description Deletes the list. Its contacts are not changed, and campaigns that were enrolled from it keep their threads.
         */
        delete: operations["deleteList"];
        options?: never;
        head?: never;
        /**
         * Rename a list or change a segment filter
         * @description Changes the name, or the filter of a dynamic list. Membership of a static list changes through addListMembers and removeListMembers.
         */
        patch: operations["updateList"];
        trace?: never;
    };
    "/lists/{listId}/members": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List the contacts in a list
         * @description Returns the contacts in a static list, or the contacts a dynamic segment matches right now, newest first. Deleted contacts are never included.
         */
        get: operations["listListMembers"];
        put?: never;
        /**
         * Add contacts to a static list
         * @description Adds up to 1,000 contacts to a static list. Contacts already in it are counted as unchanged. A dynamic list answers `conflict`: change its filter instead.
         */
        post: operations["addListMembers"];
        /**
         * Remove contacts from a static list
         * @description Removes the given contacts from a static list. The contacts themselves are not changed. A dynamic list answers `conflict`.
         */
        delete: operations["removeListMembers"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/lists/preview": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Count and sample the contacts a filter matches
         * @description Runs a filter without saving it and returns how many contacts match and the first 10 of them. Use it to check a filter before createList or listContacts. It changes nothing.
         */
        post: operations["previewSegment"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/custom-fields": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List custom field definitions
         * @description Returns the custom fields defined for contacts and companies, by entity and key. Values live in each record’s `custom_fields`.
         */
        get: operations["listCustomFields"];
        put?: never;
        /**
         * Define a custom field
         * @description Defines a typed field for contacts or companies. From then on, values written under its key are checked against its type. Values already stored are not checked or changed. Fails with `conflict` if the key is taken.
         */
        post: operations["createCustomField"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/custom-fields/{fieldId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /**
         * Delete a custom field definition
         * @description Deletes the definition. Values already stored under its key stay on the records, unchecked, and remain usable in filters and templates.
         */
        delete: operations["deleteCustomField"];
        options?: never;
        head?: never;
        /**
         * Change a custom field’s label, options or required flag
         * @description Changes the label, the options of a `select` field, or whether it is required. Values already stored are not changed. The key, entity and type are fixed.
         */
        patch: operations["updateCustomField"];
        trace?: never;
    };
    "/suppressions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List suppressed addresses and domains
         * @description Returns the suppression list, newest first. Suppressed addresses and domains are never emailed by any campaign or send path. Use checkSuppression to test one address.
         */
        get: operations["listSuppressions"];
        put?: never;
        /**
         * Suppress an address or a domain
         * @description Adds an address or a whole domain to the suppression list. It takes effect at once: threads with a matching contact stop, and nothing is sent to it again. The contact’s subscription status is not changed. Fails with `conflict` if it is already suppressed.
         */
        post: operations["createSuppression"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/suppressions/{suppressionId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /**
         * Remove a suppression
         * @description Removes an entry from the suppression list and writes it to the audit log. It does not resubscribe a contact who unsubscribed or clear a hard bounce: those stay on the contact. Needs `settings:manage`.
         */
        delete: operations["deleteSuppression"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/suppressions/check": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Check whether an address may be emailed
         * @description Says whether Catalyst would refuse to email this address, and why: a suppression (by address or domain), or the contact’s own status (unsubscribed, bounced, invalid, do-not-contact). It changes nothing.
         */
        get: operations["checkSuppression"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/campaigns": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List campaigns
         * @description Returns campaigns, newest first, with their status, settings and how many contacts are enrolled. Archived campaigns are included unless `status` filters them out.
         */
        get: operations["listCampaigns"];
        put?: never;
        /**
         * Create a draft campaign
         * @description Creates a campaign in draft with the default follow-up sequences (§5.10), using `goals` if given (goal 1 gets a sequence when a goal follows it). Give `initial_email` to start the first email; otherwise add it with updateInitialEmail. Nothing is sent until launchCampaign.
         */
        post: operations["createCampaign"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/campaigns/{campaignId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get one campaign
         * @description Returns a campaign with all its settings and mailboxes. Its goals, initial email and sequences have their own operations.
         */
        get: operations["getCampaign"];
        put?: never;
        post?: never;
        /**
         * Delete a draft campaign
         * @description Deletes a campaign that was never launched. A launched campaign answers `conflict`: archive it instead, which keeps its history.
         */
        delete: operations["deleteCampaign"];
        options?: never;
        head?: never;
        /**
         * Change a campaign’s settings
         * @description Changes only the settings you send: agent (including `agent_mode`: Catalyst’s agent, or your own through the API and MCP, §10.7), sending window, caps, tracking, compliance, enrollment rules and links. Changes apply to emails composed from now on. An archived campaign cannot change.
         */
        patch: operations["updateCampaign"];
        trace?: never;
    };
    "/campaigns/{campaignId}/archive": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Archive a campaign
         * @description Makes the campaign read-only and stops its remaining threads. Its history and statistics are kept. This cannot be undone.
         */
        post: operations["archiveCampaign"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/campaigns/{campaignId}/preflight": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Check whether a campaign is ready to launch
         * @description Runs every launch check (§8.11): goals and playbooks, the initial email and follow-ups rendered for enrolled contacts with no lint blockers, sequence rules, mailboxes and domains, compliance and audience. Any `fail` blocks launch. It changes nothing.
         */
        get: operations["runCampaignPreflight"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/campaigns/{campaignId}/launch": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Launch a campaign: start sending to enrolled contacts
         * @description Runs preflight and, if nothing fails, makes the campaign active: enrolled contacts get their initial email within caps and sending windows. A failing preflight answers 422 `preflight_failed` with the items in `errors`. Needs `messages:send`.
         */
        post: operations["launchCampaign"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/campaigns/{campaignId}/pause": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Pause a campaign’s sending
         * @description Stops all scheduled sending for the campaign. Replies are still polled and analysed, and drafts wait for approval. Undo with resumeCampaign.
         */
        post: operations["pauseCampaign"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/campaigns/{campaignId}/resume": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Resume a paused campaign
         * @description Makes a paused campaign active again. Follow-ups that fell due while paused are rescheduled from now, so nothing goes out in a burst.
         */
        post: operations["resumeCampaign"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/campaigns/{campaignId}/goals": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List a campaign’s goals in order
         * @description Returns the goals by position. A thread’s stage is "⟨goal name⟩ achieved" for the highest goal reached; the last goal is final and completes the conversation.
         */
        get: operations["listCampaignGoals"];
        put?: never;
        /**
         * Add a goal after the existing ones
         * @description Adds a goal at the end, which makes it the final goal. Fails with `conflict` if the key is taken, or if a follow-up sequence would then cover the final goal.
         */
        post: operations["createCampaignGoal"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/campaigns/{campaignId}/goals/{goalId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /**
         * Delete a goal
         * @description Deletes a goal no thread has reached and no sequence covers; the goals after it move up. Otherwise answers `conflict`.
         */
        delete: operations["deleteCampaignGoal"];
        options?: never;
        head?: never;
        /**
         * Change a goal
         * @description Changes the fields you send. Changing the key renames the goal’s follow-up stage (goal:<key>) in every sequence.
         */
        patch: operations["updateCampaignGoal"];
        trace?: never;
    };
    "/campaigns/{campaignId}/goals/reorder": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Put a campaign’s goals in a new order
         * @description Sets the goal order from `goal_ids`, which must list every goal once. Refused once any thread has reached a goal, or if a sequence would then cover the final goal.
         */
        post: operations["reorderCampaignGoals"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/campaigns/{campaignId}/initial-email": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get a campaign’s initial email and its variants
         * @description Returns the initial email (the first touch): its mode, guidance, tracking and A/B variants, each with the template problems found in it.
         */
        get: operations["getInitialEmail"];
        /**
         * Set the initial email’s mode, guidance and tracking
         * @description Sets how the initial email is written (template, AI opening line or AI writes; not AI adapts) and whether its opens are tracked. Its text lives in variants: use createStepVariant and updateStepVariant.
         */
        put: operations["updateInitialEmail"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/campaigns/{campaignId}/follow-up-sequences": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List follow-up sequences with the stage → sequence map
         * @description Returns every sequence with its steps, and which sequence covers each stage (Sent, Received, Responded and each goal but the last). A stage with no sequence gets no follow-ups and waits for its finish rule.
         */
        get: operations["listFollowUpSequences"];
        put?: never;
        /**
         * Create a follow-up sequence for one or more stages
         * @description Creates a sequence with 1 to 6 steps. A stage another active sequence covers answers 409 `stage_already_covered`, naming the stage and that sequence; waits under 24 hours answer `validation_failed`. Nothing is saved on a failure.
         */
        post: operations["createFollowUpSequence"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/campaigns/{campaignId}/follow-up-sequences/{sequenceId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get one follow-up sequence with its steps
         * @description Returns a sequence with its stages, finish rule, final wait and steps with their variants.
         */
        get: operations["getFollowUpSequence"];
        put?: never;
        post?: never;
        /**
         * Delete a follow-up sequence
         * @description Deletes the sequence and its steps. Its stages then get no follow-ups. A sequence with sent follow-ups can only be paused (active false), so their history stays.
         */
        delete: operations["deleteFollowUpSequence"];
        options?: never;
        head?: never;
        /**
         * Rename a sequence, change its stages, finish rule or wait, or pause it
         * @description Changes the fields you send. Adding a stage another active sequence covers answers 409 `stage_already_covered`. Setting `active` false stops it and frees its stages.
         */
        patch: operations["updateFollowUpSequence"];
        trace?: never;
    };
    "/campaigns/{campaignId}/follow-up-sequences/{sequenceId}/steps": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Add a step at the end of a follow-up sequence
         * @description Appends a step (at most 6 per sequence) with its wait, mode and first variant. Waits must be at least 24 hours.
         */
        post: operations["createFollowUpStep"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/campaigns/{campaignId}/follow-up-sequences/{sequenceId}/steps/{stepId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /**
         * Delete a follow-up step
         * @description Deletes a step; the steps after it move up. A sequence keeps at least one step, and a step that was already sent can’t be deleted.
         */
        delete: operations["deleteFollowUpStep"];
        options?: never;
        head?: never;
        /**
         * Change a follow-up step’s wait, mode or guidance
         * @description Changes the fields you send. The text lives in the step’s variants.
         */
        patch: operations["updateFollowUpStep"];
        trace?: never;
    };
    "/campaigns/{campaignId}/follow-up-sequences/{sequenceId}/steps/reorder": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Put a sequence’s steps in a new order
         * @description Sets the step order from `step_ids`, which must list every step of the sequence once.
         */
        post: operations["reorderFollowUpSteps"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/campaigns/{campaignId}/steps/{stepId}/variants": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Add an A/B variant to the initial email or a follow-up step
         * @description Adds a version of the step’s message. Traffic is split by weight between active variants. Template problems come back in `issues`; they block sending until fixed.
         */
        post: operations["createStepVariant"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/campaigns/{campaignId}/steps/{stepId}/variants/{variantId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /**
         * Delete a variant
         * @description Deletes a variant no email has used; a used one can only be deactivated (active false). A step keeps at least one variant.
         */
        delete: operations["deleteStepVariant"];
        options?: never;
        head?: never;
        /**
         * Change a variant’s text, weight or label
         * @description Changes the fields you send. Emails already composed keep their text. Template problems come back in `issues`.
         */
        patch: operations["updateStepVariant"];
        trace?: never;
    };
    "/campaigns/{campaignId}/steps/{stepId}/preview": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Render a step for a contact, with its lint result
         * @description Renders the initial email or a follow-up step for a contact (`contact_id`) or a thread (`thread_id`), or for a sample contact when neither is given, and lints the result (§8.7). For AI modes the template is shown as written; the AI text is not generated here. It changes nothing.
         */
        post: operations["previewCampaignStep"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/campaigns/{campaignId}/mailboxes": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /**
         * Choose the mailboxes a campaign sends from
         * @description Replaces the campaign’s mailboxes and their weights. A thread keeps the mailbox it started on; new threads pick from these (§8.3.3).
         */
        put: operations["setCampaignMailboxes"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/campaigns/{campaignId}/enrollments": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Enroll contacts in a campaign
         * @description Creates a thread for each contact given by `contact_ids` (up to 1,000) or `list_id`, and skips those that must not be emailed, reporting why: suppressed, unsubscribed, invalid, risky, active elsewhere, within the cooldown and so on (§8.5). Enrolling sends nothing by itself; an active campaign sends within its caps and windows.
         */
        post: operations["enrollContacts"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/threads": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List and filter threads (the Inbox)
         * @description Returns conversations with their stage, state, next action, open status and latest classification. Filter by campaign, stage, state, opens, intent, temperature and more; `needs_attention` gives threads waiting on a person. Sort by `-temperature` for the Hot view.
         */
        get: operations["listThreads"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/threads/{threadId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get one thread
         * @description Returns a thread’s stage, state, next action, follow-up progress, opens and latest classification. For an LLM-ready summary of everything use getThreadContext.
         */
        get: operations["getThread"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /**
         * Assign a thread, or take it over from the agent
         * @description Sets who handles the thread, and whether the agent is paused on it (`ai_paused`: you took over, so the agent writes nothing). Both are logged on the timeline.
         */
        patch: operations["updateThread"];
        trace?: never;
    };
    "/threads/{threadId}/context": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get an LLM-ready bundle of everything about a thread
         * @description Returns one markdown document with the contact card, campaign objective, goals (current one marked) and its playbook, the transcript with quotes stripped, open status, open escalations and the latest classification, plus the allowed links, shareable knowledge items and sending constraints (§14.5). Use it before drafting or deciding anything about a thread.
         */
        get: operations["getThreadContext"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/threads/{threadId}/messages": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List the emails in a thread
         * @description Returns the thread’s emails in order, oldest first, with their status, author and opens.
         */
        get: operations["listThreadMessages"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/threads/{threadId}/activity": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List what happened on a thread
         * @description Returns the thread’s activity, newest first: stage and state changes, goals, escalations, follow-ups, pauses and closes.
         */
        get: operations["listThreadActivity"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/threads/{threadId}/classifications": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List every classification of a thread, newest first
         * @description Returns each classification of the conversation (§10.4) with its answers and probabilities, model version, and the message that triggered it. While Jev is not connected, Claude’s analyses are the classifications (`provider = anthropic`).
         */
        get: operations["listThreadClassifications"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/threads/{threadId}/classify": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Classify the conversation again now
         * @description "Reclassify" (§10.4): reads the conversation again and stores the new classification on the thread (intent, sentiment, summary). Actions already taken are not run again. While Jev is not connected, Claude classifies. 409 when the contact has never replied; 503 `ai_unavailable` when the agent is off or fails.
         */
        post: operations["reclassifyThread"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/threads/{threadId}/goals/{goalId}/achieve": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Mark a goal achieved on a thread
         * @description Records the goal as achieved by hand, with every earlier goal implied (§5.2). The stage moves up, the contact’s lifecycle stage follows the goal, and the final goal completes the thread. Use `event_at` for a call’s start time so follow-ups can count from it.
         */
        post: operations["markGoalAchieved"];
        /**
         * Revoke a goal achievement that was wrong
         * @description Revokes the achievement, and the earlier goals it implied unless they were reached on their own. The stage drops to the highest remaining fact. Logged with the reason.
         */
        delete: operations["revokeGoalAchievement"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/threads/{threadId}/stage-floor": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Move a thread forward without email evidence
         * @description Sets the lowest stage the thread can show, for progress Catalyst can’t see (the contact replied by phone). It never lowers the stage; to correct a goal, revoke it. Needs a reason and is audited.
         */
        post: operations["setThreadStageFloor"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/threads/{threadId}/pause": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Pause a thread
         * @description Holds all automation on the thread: nothing is sent and no follow-up runs. Replies are still received. Undo with resumeThread.
         */
        post: operations["pauseThread"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/threads/{threadId}/resume": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Resume a paused thread
         * @description Lets automation carry on. The next follow-up is timed from now, so missed steps never go out in a burst.
         */
        post: operations["resumeThread"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/threads/{threadId}/close": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Close a thread as lost, or unsubscribe the contact
         * @description Closes the conversation: nothing more is sent, and a later reply reopens it for a person to decide (§5.4). With `unsubscribe` true the contact is also unsubscribed everywhere and suppressed, which stops all their threads.
         */
        post: operations["closeThread"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/threads/{threadId}/follow-ups/stop": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Stop follow-ups on a thread
         * @description No more follow-ups are sent on this thread; replies are still handled. Undo with resumeFollowUps.
         */
        post: operations["stopFollowUps"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/threads/{threadId}/follow-ups/resume": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Resume follow-ups on a thread
         * @description Restarts the current stage’s sequence at the next unsent step, timed from now.
         */
        post: operations["resumeFollowUps"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/threads/{threadId}/next-action/skip": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Skip the next follow-up
         * @description Skips the follow-up step that is due next; the sequence moves on to the following step, or to its finish rule. Only for a follow-up.
         */
        post: operations["skipNextAction"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/threads/{threadId}/check-in": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Check in with the contact on a date they asked for
         * @description For a "not now, try in March" reply (§5.10 rule 5): the stage’s follow-up sequence is replaced by one check-in the AI agent writes on that date (the start of the day in the contact’s timezone, then fitted to the sending window). A reply from the contact before then cancels it; if they don’t answer the check-in, the stage’s sequence restarts at step 1. A follow-up already written for the thread is cancelled. Setting it again moves it. Undo with cancelCheckIn.
         */
        post: operations["scheduleCheckIn"];
        /**
         * Cancel a check-in
         * @description Removes the thread’s check-in. The stage’s follow-up sequence takes over again, timed from now, so missed steps never go out in a burst.
         */
        delete: operations["cancelCheckIn"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/threads/{threadId}/next-action": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /**
         * Postpone the next email on a thread
         * @description Moves the next initial email or follow-up to a later time; it is still fitted into the sending window. To send sooner, use sendNextActionNow.
         */
        patch: operations["rescheduleNextAction"];
        trace?: never;
    };
    "/threads/{threadId}/next-action/send-now": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Send the thread’s next email now
         * @description Sends the thread's due initial email or follow-up now instead of at its time: composed on the spot if it hasn't been yet, then handed to the sender. It still passes every check and the mailbox's spacing. Returns 422 `send_blocked`, with each reason in `errors[].reason` (suppressed, unsubscribed, bounced, do_not_contact, outside_window, cap_reached, lint_blocker, mailbox_paused, thread_terminal), when a check fails. 409 when the next action is not an email.
         */
        post: operations["sendNextActionNow"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/threads/{threadId}/replies": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Write a reply in a thread (draft, send now, or schedule)
         * @description Creates a reply to the contact in this thread, threaded with In-Reply-To and References under "Re: " and the thread's subject. `mode=draft` stores it for review without sending (see listPendingDrafts, approveDraft). `send_now` and `schedule` need the `messages:send` scope and an Idempotency-Key, count as a person's approval, and still pass suppression, caps, the sending window and the linter. Returns 422 `send_blocked`, with each reason in `errors[].reason` (suppressed, unsubscribed, bounced, do_not_contact, outside_window, cap_reached, lint_blocker, mailbox_paused, thread_terminal), when a check fails. Any AI draft waiting on the thread is superseded.
         */
        post: operations["createReply"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/threads/{threadId}/ai-draft": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Have the agent draft a reply
         * @description The agent drafts a reply to the thread now, following the current goal’s playbook and your optional `guidance`. The draft passes the guardrails (§10.9) and waits for approval; it never sends on its own. Use createReply to write it yourself. 503 `ai_unavailable` when the agent is off or fails.
         */
        post: operations["generateAiDraft"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/messages/{messageId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get one email
         * @description Returns an email with its status, author, text and opens.
         */
        get: operations["getMessage"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /**
         * Edit a draft, or an email waiting to send
         * @description Changes the text (and, for an email that is not a reply, the subject) of a draft, an email waiting for approval, or a scheduled one that has not started sending. The text replaces the whole body, signature and footer included, and is linted again. 409 once it is sending or sent.
         */
        patch: operations["updateDraft"];
        trace?: never;
    };
    "/messages/{messageId}/raw": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Download an email as it was sent or received
         * @description The exact MIME source (`message/rfc822`) Catalyst kept: what went over SMTP, or what arrived over IMAP. 404 when no copy was kept (drafts, emails never sent).
         */
        get: operations["getMessageRaw"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/drafts": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List drafts and emails waiting for approval
         * @description Returns outbound emails in `draft` or `pending_approval`, oldest first, so the longest-waiting are reviewed first. Approve with approveDraft, edit with updateDraft, or reject with rejectDraft.
         */
        get: operations["listPendingDrafts"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/messages/{messageId}/approve": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Approve a draft to send
         * @description Approves a draft or an email waiting for approval and schedules it: now, or at `send_at`. A person's approval lets it send even if the thread is no longer active (§7.2 step 5). Returns 422 `send_blocked`, with each reason in `errors[].reason` (suppressed, unsubscribed, bounced, do_not_contact, outside_window, cap_reached, lint_blocker, mailbox_paused, thread_terminal), when a check fails.
         */
        post: operations["approveDraft"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/messages/{messageId}/reject": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Reject a draft
         * @description Rejects a draft or an email waiting for approval; it is cancelled and never sent. The reason and any feedback are logged; once the AI agent is connected, feedback is what it redrafts with.
         */
        post: operations["rejectDraft"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/messages/{messageId}/cancel": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Cancel an email before it sends
         * @description Cancels a scheduled email, or one waiting for approval, before it starts sending. A cancelled follow-up counts as skipped, so the sequence moves on (like skipNextAction). 409 once it is sending or sent.
         */
        post: operations["cancelScheduledMessage"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/messages/lint": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Check an email against the content linter
         * @description Runs the content linter (§8.7) on a subject and plain-text body: spam phrases, links, length, formatting, and the compliance footer when `compliance_required`. It stores and sends nothing.
         */
        post: operations["lintMessage"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/messages/unmatched": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List mail from known contacts that matched no thread
         * @description Returns inbound emails from known contacts that couldn’t be attached to a thread (§7.4 step 6), newest first: Inbox → Unmatched. Attach each with attachMessageToThread, or drop it with ignoreUnmatchedMessage. Mail from unknown senders is never stored, so it never shows here.
         */
        get: operations["listUnmatchedMessages"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/messages/{messageId}/attach": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Attach an unmatched email to a thread
         * @description Files an unmatched inbound email under a thread (`match_method = manual`) and acts on it exactly as if it had matched: a reply moves the thread to Responded and stops its follow-ups, a bounce or unsubscribe takes effect, someone new is added as a participant. Its `unmatched_reply` escalation is resolved.
         */
        post: operations["attachMessageToThread"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/messages/{messageId}/ignore": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Ignore an unmatched email
         * @description Takes an unmatched inbound email off the Unmatched list without filing it, and dismisses its `unmatched_reply` escalation. The email is kept.
         */
        post: operations["ignoreUnmatchedMessage"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/activities": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List activity across the workspace
         * @description Returns the event log, newest first: the dashboard’s recent activity and the Deliverability Events tab. Narrow it by thread, contact, campaign or a type prefix such as `domain.`.
         */
        get: operations["listActivities"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/escalations": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List escalations ("Needs you")
         * @description Returns escalations, most urgent first, then soonest due. By default only those waiting for a person (`open`); pass `status` for snoozed, resolved or dismissed ones.
         */
        get: operations["listEscalations"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/escalations/{escalationId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get one escalation
         * @description Returns an escalation: why it was raised, by when it is due, and how it was settled. getThreadContext has the conversation around it.
         */
        get: operations["getEscalation"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/escalations/{escalationId}/resolve": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Mark an escalation resolved
         * @description Settles an open or snoozed escalation and records how (§11.3). `took_over` also pauses the agent on the thread (ai_paused). `goal_confirmed` on a goal confirmation records its goal (`goal_id`) as reached, confirmed by you; `goal_rejected` leaves it unreached. The other resolutions record what was done elsewhere: createReply, markGoalAchieved, closeThread. Once no escalation is open, the thread resumes automation.
         */
        post: operations["resolveEscalation"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/escalations/{escalationId}/snooze": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Snooze an escalation
         * @description Hides an open escalation until `until` (at most 30 days ahead). Its SLA is paused: the due time moves by as long as it sleeps. The thread stays held meanwhile.
         */
        post: operations["snoozeEscalation"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/escalations/{escalationId}/assign": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Assign an escalation to a person
         * @description Gives the escalation to someone in the workspace, or back to the workspace owners with `user_id: null`.
         */
        post: operations["assignEscalation"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/escalations/{escalationId}/dismiss": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Dismiss an escalation
         * @description Closes an open or snoozed escalation without action, with a reason. Once no escalation is open, the thread resumes automation.
         */
        post: operations["dismissEscalation"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/escalations/{escalationId}/answer": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Answer for the agent, and get a new draft
         * @description "Answer for the agent" (§11.3): give the missing knowledge in plain language. The agent drafts the reply again with it, and the draft waits for your approval. With `save_to_knowledge` (on by default) the answer becomes a knowledge item, so the agent won’t ask again. The escalation is resolved (`answered_for_ai`). 503 `ai_unavailable` when the agent is off or fails; nothing changes then.
         */
        post: operations["answerEscalation"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/mailboxes": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List mailboxes
         * @description Returns the sending mailboxes with status, limits, warm-up, health and polling, by address. Credentials are never returned.
         */
        get: operations["listMailboxes"];
        put?: never;
        /**
         * Connect a mailbox with a password or app password
         * @description Adds a sending mailbox on a domain you already added. The password is stored encrypted and never returned. The mailbox stays pending, sending nothing, until testMailboxConnection passes. Warm-up starts at 10 a day. For Google or Microsoft OAuth, connect from Settings instead.
         */
        post: operations["createMailbox"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/mailboxes/{mailboxId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get one mailbox
         * @description Returns a mailbox with its status, limits, warm-up, health and polling. Credentials are never returned.
         */
        get: operations["getMailbox"];
        put?: never;
        post?: never;
        /**
         * Remove a mailbox that never sent
         * @description Removes a mailbox and its stored credentials. A mailbox with threads or messages cannot be removed, because its conversations would lose their sender: answers `conflict`; pause it instead.
         */
        delete: operations["deleteMailbox"];
        options?: never;
        head?: never;
        /**
         * Change a mailbox’s limits, warm-up, signature or password
         * @description Changes only the fields you send, within the fixed limits of §8.3.4: a daily limit above 150 needs `settings:manage`, sends are at least 60 s apart, and warm-up stays on for the first 14 days. A new password is audited and puts the mailbox back to pending until the connection test passes.
         */
        patch: operations["updateMailbox"];
        trace?: never;
    };
    "/mailboxes/{mailboxId}/pause": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Pause sending from a mailbox
         * @description Stops all sending from the mailbox, including replies. It is still polled, so replies are still received and handled. Undo with resumeMailbox.
         */
        post: operations["pauseMailbox"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/mailboxes/{mailboxId}/resume": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Resume sending from a paused mailbox
         * @description Resumes a paused mailbox. If a circuit breaker paused it (bounces, complaints, blocklist), you must pass `acknowledge_cause: true` to confirm you have read and dealt with the cause (§8.9); this is audited.
         */
        post: operations["resumeMailbox"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/mailboxes/{mailboxId}/dkim": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Have Catalyst sign a mailbox’s mail with its own DKIM key
         * @description For a generic SMTP host that doesn’t sign DKIM (§7.1): Catalyst makes a 2048-bit RSA key, keeps the private key encrypted, and signs every email from the mailbox with it. Publish the returned TXT record, then run checkDomainDns: the selector is added to the domain’s, so the check looks for it. Mailboxes on the same domain share one key and record. Google and Microsoft sign their own mail, so their mailboxes answer 409.
         */
        post: operations["createMailboxDkimKey"];
        /**
         * Stop signing a mailbox’s mail with Catalyst’s DKIM key
         * @description Mail from the mailbox goes out unsigned by Catalyst again. The key is deleted once no mailbox on the domain uses it; the DNS record can then be removed.
         */
        delete: operations["deleteMailboxDkimKey"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/mailboxes/{mailboxId}/test": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Run the mailbox connection test
         * @description Checks SMTP and IMAP sign-in, finds the INBOX, Sent and Junk folders, sends a test email to the mailbox itself, finds it in INBOX and reads its SPF, DKIM and DMARC results, checks the Sent copy, and deletes it (§7.1). The mailbox becomes active when the test passes. Takes up to two minutes.
         */
        post: operations["testMailboxConnection"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/mailboxes/{mailboxId}/poll": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Check a mailbox for new mail now
         * @description Queues an immediate poll ("Check now"), the same as the 30-minute schedule. Returns at once (202); see listPollRuns for the result. Answers 409 `poll_in_progress` while a poll of this mailbox is running.
         */
        post: operations["pollMailboxNow"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/deliverability": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Every domain and mailbox at a glance
         * @description The Deliverability overview (§15.15): each domain’s reputation, DNS and ramp (today’s cap and tomorrow’s if it stays Healthy), each mailbox’s status, health, sends today, warm-up and last poll, today’s planned and sent totals with the main limit, and the 20 latest deliverability events. getSendingCapacity has the full plan.
         */
        get: operations["getDeliverabilityOverview"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/capacity": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Today’s sending plan and the 7-day forecast
         * @description How many emails each domain, mailbox and campaign may send today (§8.3.3), what each has used, and the limit holding it back. Each campaign has its pace and a forecast finish date for the threads waiting for a first email. `forecast` projects 7 days assuming every band stays Healthy, so ramps and warm-ups keep moving. Filter by domain, mailbox or campaign.
         */
        get: operations["getSendingCapacity"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/mailboxes/{mailboxId}/poll-runs": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List a mailbox’s recent polls
         * @description Returns the mailbox’s IMAP polls, newest first, with how many messages each fetched and matched and any error.
         */
        get: operations["listPollRuns"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/mailboxes/{mailboxId}/stats": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get a mailbox’s daily sending, bounce and reply counts
         * @description Returns per-day counts for the last `days` days (default 30) with totals, and the inputs of the mailbox health score.
         */
        get: operations["getMailboxStats"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/domains": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List sending domains
         * @description Returns every sending domain with its DNS check, reputation band and ramp in brief, by name. Use getDomainRamp or getDomainReputation for the detail.
         */
        get: operations["listDomains"];
        put?: never;
        /**
         * Add a sending domain
         * @description Adds a domain to send from and starts it on a ramp plan (new_domain unless told otherwise). Then publish the SPF, DKIM, DMARC and tracking records and run checkDomainDns; add mailboxes with createMailbox. Fails with `conflict` if the domain is already added.
         */
        post: operations["createDomain"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/domains/{domainId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get one sending domain
         * @description Returns a domain with its last DNS check record by record, reputation band and ramp in brief.
         */
        get: operations["getDomain"];
        put?: never;
        post?: never;
        /**
         * Remove a sending domain
         * @description Removes a domain that has no mailboxes. Fails with `conflict` while mailboxes still use it; delete or move those first.
         */
        delete: operations["deleteDomain"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/domains/{domainId}/check": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Check a domain’s SPF, DKIM, DMARC, MX and tracking records now
         * @description Looks up the domain’s DNS records, stores the result and returns the domain. Each record comes with what was found and what is expected, so a failing one can be fixed by copying the expected value. Failing SPF, DKIM, DMARC or MX blocks campaign launch (§8.2). It also runs daily.
         */
        post: operations["checkDomainDns"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/domains/{domainId}/first-touches/resume": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Let first emails go again after an authentication failure
         * @description When SPF, DKIM or DMARC stops passing, Catalyst stops first emails from the domain and tells the owners (§8.9). Once the records pass again (run checkDomainDns), this lets them go again. Pass `acknowledge_cause: true` to confirm you have read and dealt with the cause; this is audited. Answers 409 while a record still fails.
         */
        post: operations["resumeDomainFirstTouches"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/domains/{domainId}/reputation": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get a domain’s reputation score, what it costs and its history
         * @description Returns the domain reputation score and band, the points each input cost in the last recompute (§8.10), and the score per day for 30 days. Scores are measured and cannot be changed.
         */
        get: operations["getDomainReputation"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/domains/{domainId}/ramp": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get a domain’s ramp plan, schedule and planned vs sent history
         * @description Returns the ramp plan, current step, today’s and tomorrow’s cap, the full schedule, any cap override and 30 days of planned vs sent volume (§8.3).
         */
        get: operations["getDomainRamp"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /**
         * Change a domain’s ramp plan
         * @description Switches the plan (new_domain, aged_domain, established or custom with a schedule). The domain keeps its step; established jumps to the full mailbox total, so use it only for domains already sending outreach with good results. Needs `settings:manage`; written to the audit log with the reason.
         */
        patch: operations["updateDomainRamp"];
        trace?: never;
    };
    "/domains/{domainId}/ramp/hold": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Hold a domain’s ramp at its current step
         * @description Stops the ramp moving up until resumeDomainRamp. Reputation can still step it back. Needs `settings:manage`; written to the audit log with the reason.
         */
        post: operations["holdDomainRamp"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/domains/{domainId}/ramp/resume": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Let a held ramp move up again
         * @description Ends a manual hold. The ramp moves up again on the next Healthy sending day. Needs `settings:manage`; written to the audit log with the reason.
         */
        post: operations["resumeDomainRamp"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/domains/{domainId}/ramp/step-back": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Drop a domain’s ramp back by hand
         * @description Moves the ramp back by `steps` (default 1), lowering today’s cap at the next plan run. Needs `settings:manage`; written to the audit log with the reason.
         */
        post: operations["stepBackDomainRamp"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/domains/{domainId}/cap-override": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /**
         * Set a temporary daily cap for a domain
         * @description Replaces the ramp step’s cap until `until` (at most 14 days). Lowering has no limit; raising is limited to 50% above the current step and answers `validation_failed` beyond that. Needs `settings:manage`; audited.
         */
        put: operations["setDomainCapOverride"];
        post?: never;
        /**
         * Remove a domain’s temporary cap
         * @description Ends a cap override early; the ramp step’s cap applies again. Needs `settings:manage`; audited.
         */
        delete: operations["clearDomainCapOverride"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/webhooks": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List webhook endpoints
         * @description Returns the workspace’s webhook endpoints, oldest first. Secrets are never returned after creation.
         */
        get: operations["listWebhookEndpoints"];
        put?: never;
        /**
         * Add a webhook endpoint
         * @description Registers a URL to receive the chosen events as signed POSTs (§13.6): the envelope `{id, type, created_at, workspace_id, data}`, signed in `Catalyst-Signature: t=<unix>,v1=<hex HMAC-SHA256(secret, t + "." + body)>`. The signing `secret` is in this response only; keep it. Events from before the endpoint existed are not sent.
         */
        post: operations["createWebhookEndpoint"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/webhooks/{endpointId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /**
         * Delete a webhook endpoint
         * @description Removes the endpoint and its delivery log. Nothing more is sent to it.
         */
        delete: operations["deleteWebhookEndpoint"];
        options?: never;
        head?: never;
        /**
         * Change a webhook endpoint
         * @description Changes the URL, description or events, or turns the endpoint off or on. Turning it back on clears its failure count; deliveries that failed meanwhile can be sent again with redeliverWebhook.
         */
        patch: operations["updateWebhookEndpoint"];
        trace?: never;
    };
    "/webhooks/{endpointId}/test": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Send a test event to a webhook endpoint
         * @description POSTs a signed `webhook.test` event to the endpoint now and returns the delivery with the answer. It is not retried.
         */
        post: operations["testWebhookEndpoint"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/webhooks/{endpointId}/deliveries": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List an endpoint’s deliveries
         * @description The delivery log of one endpoint, newest first, with each one’s attempts and last answer.
         */
        get: operations["listWebhookDeliveries"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/webhook-deliveries/{deliveryId}/redeliver": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Send a delivery again
         * @description Queues another attempt of a delivery now, whatever its status, with a fresh signature. The endpoint must be on.
         */
        post: operations["redeliverWebhook"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/integrations": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List integrations
         * @description The workspace’s Stripe, Cal.com, Calendly and generic integrations, with the webhook path each one’s provider should call. Secrets are never returned.
         */
        get: operations["listIntegrations"];
        put?: never;
        /**
         * Connect an integration
         * @description Adds a source of goal events (§13.7). For Stripe, Cal.com and Calendly, give the signing secret the provider shows for the webhook, and point the provider at `webhook_path`. For `generic`, Catalyst makes the secret and returns it once: sign each POST to ingestIntegrationEvent with it.
         */
        post: operations["createIntegration"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/integrations/{integrationId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /**
         * Disconnect an integration
         * @description Turns the integration off: its events are refused from now on. Events already received are kept.
         */
        delete: operations["deleteIntegration"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/integration-events": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List received integration events
         * @description Every booking and payment event received, newest first, with what came of it. Filter by `outcome` to find the unmatched ones and attach them with attachIntegrationEvent.
         */
        get: operations["listIntegrationEvents"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/integration-events/{eventId}/attach": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Achieve a goal from an unmatched integration event
         * @description Files an event that matched no thread under a thread and goal by hand, and writes the achievement as if it had matched (`external_event`, confidence 1).
         */
        post: operations["attachIntegrationEvent"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/integrations/events": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Report a goal event from your own system
         * @description For anything without a built-in integration: report that a contact reached a goal (`goal_key`, e.g. `paid`). Authenticated by its signature, not an API key: `Catalyst-Signature: t=<unix>,v1=<hex HMAC-SHA256(secret, t + "." + body)>`, checked against the integration's signing secret. Send the integration's ID in `Catalyst-Integration`. Events are stored once per `(source, external_id)`; older than 5 minutes is refused.
         */
        post: operations["ingestIntegrationEvent"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/integrations/stripe/webhook": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Receive Stripe webhooks
         * @description The URL to give Stripe (§13.7), with `?integration_id=`. Acts on `checkout.session.completed` and `invoice.paid`; other events are stored and ignored. Authenticated by its signature, not an API key: `Stripe-Signature`, checked against the integration's signing secret. The body is Stripe's own event JSON.
         */
        post: operations["receiveStripeWebhook"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/integrations/calcom/webhook": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Receive Cal.com webhooks
         * @description The URL to give Cal.com (§13.7), with `?integration_id=`. Acts on `BOOKING_CREATED`; other events are stored and ignored. Authenticated by its signature, not an API key: `X-Cal-Signature-256`, checked against the integration's signing secret. The body is Cal.com's own event JSON.
         */
        post: operations["receiveCalcomWebhook"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/integrations/calendly/webhook": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Receive Calendly webhooks
         * @description The URL to give Calendly (§13.7), with `?integration_id=`. Acts on `invitee.created`; other events are stored and ignored. Authenticated by its signature, not an API key: `Calendly-Webhook-Signature`, checked against the integration's signing secret. The body is Calendly's own event JSON.
         */
        post: operations["receiveCalendlyWebhook"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/analytics/overview": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * The Dashboard: what needs you, sends, replies, goals and deliverability
         * @description The Dashboard tiles (§15.4) for the last `days` days: what is waiting for a person, today’s sends against the capacity plan, the reply rate against the period before with a daily line, goals reached with their estimated value, each live campaign’s funnel, deliverability at a glance, and recent activity.
         */
        get: operations["getDashboardOverview"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/analytics/funnel": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * The funnel: sent, received, responded, then each goal
         * @description How many threads reached each stage and goal, with each step’s conversion. One campaign, or every campaign with goals grouped by key. With `days`, only threads whose first email went out in that time.
         */
        get: operations["getFunnel"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/campaigns/{campaignId}/stats": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * A campaign’s funnel, emails, steps, variants and goals
         * @description The campaign Overview numbers (§15.9): the funnel, threads by state, emails sent, opened (by people), bounced and replied to, each step and A/B variant with its reply rate, and each goal with its estimated value. A reply is credited to the last email sent before it. With `days`, only the recent part.
         */
        get: operations["getCampaignStats"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/analytics/knowledge-gaps": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * The questions the knowledge base couldn’t answer, most asked first
         * @description Analytics → Knowledge gaps (§11.3): the questions in `knowledge_gap` escalations, grouped when they read the same (case, spacing and punctuation aside), most asked first, with how many are still open and whether an answer was saved as knowledge. Fix the commonest with createKnowledgeItem, or answer them with answerEscalation.
         */
        get: operations["listKnowledgeGaps"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/knowledge": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List knowledge items
         * @description The knowledge base, by kind then title. Filter by scope (`campaign_id`, or `workspace` for workspace-wide items), kind, source, active, or text in the title and content.
         */
        get: operations["listKnowledgeItems"];
        put?: never;
        /**
         * Add a knowledge item
         * @description Adds a fact the agent may use: workspace-wide, or for one campaign. Internal items are for people only and never reach the model.
         */
        post: operations["createKnowledgeItem"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/knowledge/{itemId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get one knowledge item
         * @description Returns a knowledge item with its scope, visibility and source.
         */
        get: operations["getKnowledgeItem"];
        put?: never;
        post?: never;
        /**
         * Delete a knowledge item
         * @description Removes a knowledge item; the agent stops using it at once. Escalations that taught it keep their link.
         */
        delete: operations["deleteKnowledgeItem"];
        options?: never;
        head?: never;
        /**
         * Change a knowledge item
         * @description Changes any field of a knowledge item. Turning `active` off keeps it but stops the agent using it.
         */
        patch: operations["updateKnowledgeItem"];
        trace?: never;
    };
    "/knowledge/test": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Ask the agent a prospect’s question
         * @description "Test the agent" (§15.17): asks the agent a question as a prospect might, against a campaign’s shareable knowledge (or the workspace’s). It answers with the items it cites, or says it would escalate as a knowledge gap. Nothing is stored or sent. 503 `ai_unavailable` when the agent is off or fails.
         */
        post: operations["testKnowledge"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/settings": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get the workspace settings
         * @description The workspace’s name, physical address, timezone, business hours, notification settings, and the AI budget with this month’s spend.
         */
        get: operations["getWorkspaceSettings"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /**
         * Change the workspace settings
         * @description Changes the name, physical address, timezone, business hours, notification settings or AI budget. The address appears in every compliance footer from the next email on; business hours apply to escalations raised from now on.
         */
        patch: operations["updateWorkspaceSettings"];
        trace?: never;
    };
    "/users": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List the team
         * @description The people in the workspace with their roles, by name. Removed people are left out unless `include_removed=true`.
         */
        get: operations["listUsers"];
        put?: never;
        /**
         * Add someone to the team
         * @description Adds a person with a role and emails them an invitation through the system SMTP. Someone removed earlier with the same email is brought back with the new role.
         */
        post: operations["inviteUser"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/users/{userId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /**
         * Remove someone from the team
         * @description Removes a person: they get no more mail, their threads, open escalations, campaigns and mailboxes lose them as assignee or owner (escalations fall back to the workspace owners). Their name stays on what they did. The last owner can’t be removed (409).
         */
        delete: operations["removeUser"];
        options?: never;
        head?: never;
        /**
         * Change someone’s role or preferences
         * @description Changes a person’s name, role, timezone or notification preferences. The last owner can’t be demoted (409).
         */
        patch: operations["updateUser"];
        trace?: never;
    };
    "/api-keys": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List the workspace’s API keys
         * @description Every key with its scopes and when it was last used; revoked keys only with `include_revoked=true`. Never the secrets. For owners and admins, signed in.
         */
        get: operations["listApiKeys"];
        put?: never;
        /**
         * Make an API key
         * @description Makes a key with the given scopes and returns its secret, the only time it is shown. Give an agent the narrowest scopes it needs, e.g. threads read and write without messages:send for draft-only (§14.2). For owners and admins, signed in; not an MCP tool.
         */
        post: operations["createApiKey"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api-keys/{keyId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /**
         * Revoke an API key
         * @description The key stops working at once. It stays listed (with `include_revoked=true`) for the audit trail. For owners and admins, signed in; not an MCP tool.
         */
        delete: operations["revokeApiKey"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/settings/ai/usage": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * What the AI agent cost, and how its runs went
         * @description Settings → AI’s spend chart (§10.2): every Claude and Jev run in the last `days` days, by day in the workspace timezone, by task and by model, with tokens, failures (refusals, errors, invalid output), guardrail blocks and median latency, plus this month’s budget, the classification fallback rate and the Jev/Claude disagreement rate (§15.18 shows the last 7 days).
         */
        get: operations["getAiUsage"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/me/push": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Browser push: the server’s key and your subscribed browsers
         * @description The VAPID public key a browser subscribes with (`applicationServerKey`), null when push isn’t set up on this server, and the browsers that get your urgent and high alerts (§11.2).
         */
        get: operations["getPushSettings"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/me/push/subscriptions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Show alerts in this browser
         * @description Saves a browser’s push subscription, as `PushSubscription.toJSON()` gives it. Urgent and high alerts then reach it (high ones after quiet hours). Subscribing the same browser again replaces the old subscription.
         */
        post: operations["createPushSubscription"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/me/push/subscriptions/{subscriptionId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /**
         * Stop showing alerts in a browser
         * @description Removes one of your browsers from push: it gets no more alerts. Other browsers you subscribed keep theirs.
         */
        delete: operations["deletePushSubscription"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
}
export interface webhooks {
    "thread.stage_changed": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * A thread moved to another stage.
         * @description Sent to endpoints subscribed to `thread.stage_changed`, signed in `Catalyst-Signature: t=<unix>,v1=<hex HMAC-SHA256(secret, t + "." + body)>`. Reject anything older than 5 minutes. Answer 2xx; anything else is retried at 1 m, 5 m, 30 m, 2 h, 6 h, 12 h and 24 h.
         */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: {
                content: {
                    "application/json": {
                        /** @description The event ID (`evt_…`), the same for every endpoint; use it to drop duplicates. */
                        id: string;
                        /** @constant */
                        type: "thread.stage_changed";
                        /**
                         * Format: date-time
                         * @description When it happened.
                         */
                        created_at: string;
                        workspace_id: string;
                        /** @description What happened, with `thread_id`, `contact_id` and `campaign_id` where they apply. */
                        data: {
                            [key: string]: unknown;
                        };
                    };
                };
            };
            responses: {
                /** @description Received. */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "thread.state_changed": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * A thread’s state changed (active, paused, needs_human, …).
         * @description Sent to endpoints subscribed to `thread.state_changed`, signed in `Catalyst-Signature: t=<unix>,v1=<hex HMAC-SHA256(secret, t + "." + body)>`. Reject anything older than 5 minutes. Answer 2xx; anything else is retried at 1 m, 5 m, 30 m, 2 h, 6 h, 12 h and 24 h.
         */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: {
                content: {
                    "application/json": {
                        /** @description The event ID (`evt_…`), the same for every endpoint; use it to drop duplicates. */
                        id: string;
                        /** @constant */
                        type: "thread.state_changed";
                        /**
                         * Format: date-time
                         * @description When it happened.
                         */
                        created_at: string;
                        workspace_id: string;
                        /** @description What happened, with `thread_id`, `contact_id` and `campaign_id` where they apply. */
                        data: {
                            [key: string]: unknown;
                        };
                    };
                };
            };
            responses: {
                /** @description Received. */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "thread.goal_achieved": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * A thread reached a goal.
         * @description Sent to endpoints subscribed to `thread.goal_achieved`, signed in `Catalyst-Signature: t=<unix>,v1=<hex HMAC-SHA256(secret, t + "." + body)>`. Reject anything older than 5 minutes. Answer 2xx; anything else is retried at 1 m, 5 m, 30 m, 2 h, 6 h, 12 h and 24 h.
         */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: {
                content: {
                    "application/json": {
                        /** @description The event ID (`evt_…`), the same for every endpoint; use it to drop duplicates. */
                        id: string;
                        /** @constant */
                        type: "thread.goal_achieved";
                        /**
                         * Format: date-time
                         * @description When it happened.
                         */
                        created_at: string;
                        workspace_id: string;
                        /** @description What happened, with `thread_id`, `contact_id` and `campaign_id` where they apply. */
                        data: {
                            [key: string]: unknown;
                        };
                    };
                };
            };
            responses: {
                /** @description Received. */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "thread.classified": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * A thread’s top intent or temperature level changed.
         * @description Sent to endpoints subscribed to `thread.classified`, signed in `Catalyst-Signature: t=<unix>,v1=<hex HMAC-SHA256(secret, t + "." + body)>`. Reject anything older than 5 minutes. Answer 2xx; anything else is retried at 1 m, 5 m, 30 m, 2 h, 6 h, 12 h and 24 h.
         */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: {
                content: {
                    "application/json": {
                        /** @description The event ID (`evt_…`), the same for every endpoint; use it to drop duplicates. */
                        id: string;
                        /** @constant */
                        type: "thread.classified";
                        /**
                         * Format: date-time
                         * @description When it happened.
                         */
                        created_at: string;
                        workspace_id: string;
                        /** @description What happened, with `thread_id`, `contact_id` and `campaign_id` where they apply. */
                        data: {
                            [key: string]: unknown;
                        };
                    };
                };
            };
            responses: {
                /** @description Received. */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "message.sent": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * An email was sent.
         * @description Sent to endpoints subscribed to `message.sent`, signed in `Catalyst-Signature: t=<unix>,v1=<hex HMAC-SHA256(secret, t + "." + body)>`. Reject anything older than 5 minutes. Answer 2xx; anything else is retried at 1 m, 5 m, 30 m, 2 h, 6 h, 12 h and 24 h.
         */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: {
                content: {
                    "application/json": {
                        /** @description The event ID (`evt_…`), the same for every endpoint; use it to drop duplicates. */
                        id: string;
                        /** @constant */
                        type: "message.sent";
                        /**
                         * Format: date-time
                         * @description When it happened.
                         */
                        created_at: string;
                        workspace_id: string;
                        /** @description What happened, with `thread_id`, `contact_id` and `campaign_id` where they apply. */
                        data: {
                            [key: string]: unknown;
                        };
                    };
                };
            };
            responses: {
                /** @description Received. */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "message.received": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * An email arrived on a thread.
         * @description Sent to endpoints subscribed to `message.received`, signed in `Catalyst-Signature: t=<unix>,v1=<hex HMAC-SHA256(secret, t + "." + body)>`. Reject anything older than 5 minutes. Answer 2xx; anything else is retried at 1 m, 5 m, 30 m, 2 h, 6 h, 12 h and 24 h.
         */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: {
                content: {
                    "application/json": {
                        /** @description The event ID (`evt_…`), the same for every endpoint; use it to drop duplicates. */
                        id: string;
                        /** @constant */
                        type: "message.received";
                        /**
                         * Format: date-time
                         * @description When it happened.
                         */
                        created_at: string;
                        workspace_id: string;
                        /** @description What happened, with `thread_id`, `contact_id` and `campaign_id` where they apply. */
                        data: {
                            [key: string]: unknown;
                        };
                    };
                };
            };
            responses: {
                /** @description Received. */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "message.opened": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * A person opened an email for the first time.
         * @description Sent to endpoints subscribed to `message.opened`, signed in `Catalyst-Signature: t=<unix>,v1=<hex HMAC-SHA256(secret, t + "." + body)>`. Reject anything older than 5 minutes. Answer 2xx; anything else is retried at 1 m, 5 m, 30 m, 2 h, 6 h, 12 h and 24 h.
         */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: {
                content: {
                    "application/json": {
                        /** @description The event ID (`evt_…`), the same for every endpoint; use it to drop duplicates. */
                        id: string;
                        /** @constant */
                        type: "message.opened";
                        /**
                         * Format: date-time
                         * @description When it happened.
                         */
                        created_at: string;
                        workspace_id: string;
                        /** @description What happened, with `thread_id`, `contact_id` and `campaign_id` where they apply. */
                        data: {
                            [key: string]: unknown;
                        };
                    };
                };
            };
            responses: {
                /** @description Received. */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "message.bounced": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * An email bounced.
         * @description Sent to endpoints subscribed to `message.bounced`, signed in `Catalyst-Signature: t=<unix>,v1=<hex HMAC-SHA256(secret, t + "." + body)>`. Reject anything older than 5 minutes. Answer 2xx; anything else is retried at 1 m, 5 m, 30 m, 2 h, 6 h, 12 h and 24 h.
         */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: {
                content: {
                    "application/json": {
                        /** @description The event ID (`evt_…`), the same for every endpoint; use it to drop duplicates. */
                        id: string;
                        /** @constant */
                        type: "message.bounced";
                        /**
                         * Format: date-time
                         * @description When it happened.
                         */
                        created_at: string;
                        workspace_id: string;
                        /** @description What happened, with `thread_id`, `contact_id` and `campaign_id` where they apply. */
                        data: {
                            [key: string]: unknown;
                        };
                    };
                };
            };
            responses: {
                /** @description Received. */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "draft.pending_approval": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * An email is waiting for approval.
         * @description Sent to endpoints subscribed to `draft.pending_approval`, signed in `Catalyst-Signature: t=<unix>,v1=<hex HMAC-SHA256(secret, t + "." + body)>`. Reject anything older than 5 minutes. Answer 2xx; anything else is retried at 1 m, 5 m, 30 m, 2 h, 6 h, 12 h and 24 h.
         */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: {
                content: {
                    "application/json": {
                        /** @description The event ID (`evt_…`), the same for every endpoint; use it to drop duplicates. */
                        id: string;
                        /** @constant */
                        type: "draft.pending_approval";
                        /**
                         * Format: date-time
                         * @description When it happened.
                         */
                        created_at: string;
                        workspace_id: string;
                        /** @description What happened, with `thread_id`, `contact_id` and `campaign_id` where they apply. */
                        data: {
                            [key: string]: unknown;
                        };
                    };
                };
            };
            responses: {
                /** @description Received. */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "escalation.created": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * An escalation was raised.
         * @description Sent to endpoints subscribed to `escalation.created`, signed in `Catalyst-Signature: t=<unix>,v1=<hex HMAC-SHA256(secret, t + "." + body)>`. Reject anything older than 5 minutes. Answer 2xx; anything else is retried at 1 m, 5 m, 30 m, 2 h, 6 h, 12 h and 24 h.
         */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: {
                content: {
                    "application/json": {
                        /** @description The event ID (`evt_…`), the same for every endpoint; use it to drop duplicates. */
                        id: string;
                        /** @constant */
                        type: "escalation.created";
                        /**
                         * Format: date-time
                         * @description When it happened.
                         */
                        created_at: string;
                        workspace_id: string;
                        /** @description What happened, with `thread_id`, `contact_id` and `campaign_id` where they apply. */
                        data: {
                            [key: string]: unknown;
                        };
                    };
                };
            };
            responses: {
                /** @description Received. */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "escalation.resolved": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * An escalation was resolved or dismissed.
         * @description Sent to endpoints subscribed to `escalation.resolved`, signed in `Catalyst-Signature: t=<unix>,v1=<hex HMAC-SHA256(secret, t + "." + body)>`. Reject anything older than 5 minutes. Answer 2xx; anything else is retried at 1 m, 5 m, 30 m, 2 h, 6 h, 12 h and 24 h.
         */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: {
                content: {
                    "application/json": {
                        /** @description The event ID (`evt_…`), the same for every endpoint; use it to drop duplicates. */
                        id: string;
                        /** @constant */
                        type: "escalation.resolved";
                        /**
                         * Format: date-time
                         * @description When it happened.
                         */
                        created_at: string;
                        workspace_id: string;
                        /** @description What happened, with `thread_id`, `contact_id` and `campaign_id` where they apply. */
                        data: {
                            [key: string]: unknown;
                        };
                    };
                };
            };
            responses: {
                /** @description Received. */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "contact.created": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * A contact was created.
         * @description Sent to endpoints subscribed to `contact.created`, signed in `Catalyst-Signature: t=<unix>,v1=<hex HMAC-SHA256(secret, t + "." + body)>`. Reject anything older than 5 minutes. Answer 2xx; anything else is retried at 1 m, 5 m, 30 m, 2 h, 6 h, 12 h and 24 h.
         */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: {
                content: {
                    "application/json": {
                        /** @description The event ID (`evt_…`), the same for every endpoint; use it to drop duplicates. */
                        id: string;
                        /** @constant */
                        type: "contact.created";
                        /**
                         * Format: date-time
                         * @description When it happened.
                         */
                        created_at: string;
                        workspace_id: string;
                        /** @description What happened, with `thread_id`, `contact_id` and `campaign_id` where they apply. */
                        data: {
                            [key: string]: unknown;
                        };
                    };
                };
            };
            responses: {
                /** @description Received. */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "contact.unsubscribed": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * A contact unsubscribed.
         * @description Sent to endpoints subscribed to `contact.unsubscribed`, signed in `Catalyst-Signature: t=<unix>,v1=<hex HMAC-SHA256(secret, t + "." + body)>`. Reject anything older than 5 minutes. Answer 2xx; anything else is retried at 1 m, 5 m, 30 m, 2 h, 6 h, 12 h and 24 h.
         */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: {
                content: {
                    "application/json": {
                        /** @description The event ID (`evt_…`), the same for every endpoint; use it to drop duplicates. */
                        id: string;
                        /** @constant */
                        type: "contact.unsubscribed";
                        /**
                         * Format: date-time
                         * @description When it happened.
                         */
                        created_at: string;
                        workspace_id: string;
                        /** @description What happened, with `thread_id`, `contact_id` and `campaign_id` where they apply. */
                        data: {
                            [key: string]: unknown;
                        };
                    };
                };
            };
            responses: {
                /** @description Received. */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "campaign.status_changed": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * A campaign was launched, paused, resumed, completed or archived.
         * @description Sent to endpoints subscribed to `campaign.status_changed`, signed in `Catalyst-Signature: t=<unix>,v1=<hex HMAC-SHA256(secret, t + "." + body)>`. Reject anything older than 5 minutes. Answer 2xx; anything else is retried at 1 m, 5 m, 30 m, 2 h, 6 h, 12 h and 24 h.
         */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: {
                content: {
                    "application/json": {
                        /** @description The event ID (`evt_…`), the same for every endpoint; use it to drop duplicates. */
                        id: string;
                        /** @constant */
                        type: "campaign.status_changed";
                        /**
                         * Format: date-time
                         * @description When it happened.
                         */
                        created_at: string;
                        workspace_id: string;
                        /** @description What happened, with `thread_id`, `contact_id` and `campaign_id` where they apply. */
                        data: {
                            [key: string]: unknown;
                        };
                    };
                };
            };
            responses: {
                /** @description Received. */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "mailbox.health_changed": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * A mailbox’s health band changed.
         * @description Sent to endpoints subscribed to `mailbox.health_changed`, signed in `Catalyst-Signature: t=<unix>,v1=<hex HMAC-SHA256(secret, t + "." + body)>`. Reject anything older than 5 minutes. Answer 2xx; anything else is retried at 1 m, 5 m, 30 m, 2 h, 6 h, 12 h and 24 h.
         */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: {
                content: {
                    "application/json": {
                        /** @description The event ID (`evt_…`), the same for every endpoint; use it to drop duplicates. */
                        id: string;
                        /** @constant */
                        type: "mailbox.health_changed";
                        /**
                         * Format: date-time
                         * @description When it happened.
                         */
                        created_at: string;
                        workspace_id: string;
                        /** @description What happened, with `thread_id`, `contact_id` and `campaign_id` where they apply. */
                        data: {
                            [key: string]: unknown;
                        };
                    };
                };
            };
            responses: {
                /** @description Received. */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "mailbox.poll_failed": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * A mailbox failed two scheduled polls in a row.
         * @description Sent to endpoints subscribed to `mailbox.poll_failed`, signed in `Catalyst-Signature: t=<unix>,v1=<hex HMAC-SHA256(secret, t + "." + body)>`. Reject anything older than 5 minutes. Answer 2xx; anything else is retried at 1 m, 5 m, 30 m, 2 h, 6 h, 12 h and 24 h.
         */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: {
                content: {
                    "application/json": {
                        /** @description The event ID (`evt_…`), the same for every endpoint; use it to drop duplicates. */
                        id: string;
                        /** @constant */
                        type: "mailbox.poll_failed";
                        /**
                         * Format: date-time
                         * @description When it happened.
                         */
                        created_at: string;
                        workspace_id: string;
                        /** @description What happened, with `thread_id`, `contact_id` and `campaign_id` where they apply. */
                        data: {
                            [key: string]: unknown;
                        };
                    };
                };
            };
            responses: {
                /** @description Received. */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "deliverability.breaker_tripped": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * A circuit breaker paused a mailbox, a domain’s mailboxes or a campaign.
         * @description Sent to endpoints subscribed to `deliverability.breaker_tripped`, signed in `Catalyst-Signature: t=<unix>,v1=<hex HMAC-SHA256(secret, t + "." + body)>`. Reject anything older than 5 minutes. Answer 2xx; anything else is retried at 1 m, 5 m, 30 m, 2 h, 6 h, 12 h and 24 h.
         */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: {
                content: {
                    "application/json": {
                        /** @description The event ID (`evt_…`), the same for every endpoint; use it to drop duplicates. */
                        id: string;
                        /** @constant */
                        type: "deliverability.breaker_tripped";
                        /**
                         * Format: date-time
                         * @description When it happened.
                         */
                        created_at: string;
                        workspace_id: string;
                        /** @description What happened, with `thread_id`, `contact_id` and `campaign_id` where they apply. */
                        data: {
                            [key: string]: unknown;
                        };
                    };
                };
            };
            responses: {
                /** @description Received. */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "domain.reputation_changed": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * A domain’s reputation band changed.
         * @description Sent to endpoints subscribed to `domain.reputation_changed`, signed in `Catalyst-Signature: t=<unix>,v1=<hex HMAC-SHA256(secret, t + "." + body)>`. Reject anything older than 5 minutes. Answer 2xx; anything else is retried at 1 m, 5 m, 30 m, 2 h, 6 h, 12 h and 24 h.
         */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: {
                content: {
                    "application/json": {
                        /** @description The event ID (`evt_…`), the same for every endpoint; use it to drop duplicates. */
                        id: string;
                        /** @constant */
                        type: "domain.reputation_changed";
                        /**
                         * Format: date-time
                         * @description When it happened.
                         */
                        created_at: string;
                        workspace_id: string;
                        /** @description What happened, with `thread_id`, `contact_id` and `campaign_id` where they apply. */
                        data: {
                            [key: string]: unknown;
                        };
                    };
                };
            };
            responses: {
                /** @description Received. */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "domain.ramp_changed": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * A domain’s ramp moved, held, stepped back, or had its plan or cap changed.
         * @description Sent to endpoints subscribed to `domain.ramp_changed`, signed in `Catalyst-Signature: t=<unix>,v1=<hex HMAC-SHA256(secret, t + "." + body)>`. Reject anything older than 5 minutes. Answer 2xx; anything else is retried at 1 m, 5 m, 30 m, 2 h, 6 h, 12 h and 24 h.
         */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: {
                content: {
                    "application/json": {
                        /** @description The event ID (`evt_…`), the same for every endpoint; use it to drop duplicates. */
                        id: string;
                        /** @constant */
                        type: "domain.ramp_changed";
                        /**
                         * Format: date-time
                         * @description When it happened.
                         */
                        created_at: string;
                        workspace_id: string;
                        /** @description What happened, with `thread_id`, `contact_id` and `campaign_id` where they apply. */
                        data: {
                            [key: string]: unknown;
                        };
                    };
                };
            };
            responses: {
                /** @description Received. */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
}
export interface components {
    schemas: {
        /**
         * @description Where the contact stands in the sales lifecycle. Automatic moves never go backwards.
         * @enum {string}
         */
        LifecycleStage: "lead" | "prospect" | "engaged" | "opportunity" | "customer" | "churned" | "disqualified";
        /**
         * @description Result of verifying the email address (§8.5).
         * @enum {string}
         */
        EmailVerification: "unverified" | "valid" | "risky" | "catch_all" | "invalid" | "bounced";
        /**
         * @description Whether the contact may be emailed. Applies to every campaign.
         * @enum {string}
         */
        SubscriptionStatus: "subscribed" | "unsubscribed" | "complained";
        /** @description A new contact. Only `email` is required. */
        CreateContact: {
            /**
             * Format: email
             * @description Email address. Trimmed and lower-cased on write.
             * @example priya@globex.com
             */
            email: string;
            /**
             * @description Given name.
             * @example Priya
             */
            first_name?: string | null;
            /**
             * @description Family name.
             * @example Natarajan
             */
            last_name?: string | null;
            /**
             * @description Job title.
             * @example VP Operations
             */
            title?: string | null;
            /** @description Phone number, free text. */
            phone?: string | null;
            /** @description LinkedIn profile URL. */
            linkedin_url?: string | null;
            company_id?: string | null;
            /** @description City, used to infer the timezone. */
            city?: string | null;
            /**
             * @description ISO 3166-1 alpha-2 country code.
             * @example US
             */
            country?: string | null;
            /**
             * @description IANA timezone. Inferred from city and country when null.
             * @example America/Los_Angeles
             */
            timezone?: string | null;
            lifecycle_stage?: components["schemas"]["LifecycleStage"];
            owner_user_id?: string | null;
            consent_basis?: components["schemas"]["ConsentBasis"];
            /** @description When true the contact is never emailed, whatever its subscription status. */
            do_not_contact?: boolean;
            /**
             * @description Values of the custom fields defined for contacts, by field key.
             * @example {
             *       "industry": "SaaS"
             *     }
             */
            custom_fields?: {
                [key: string]: unknown;
            };
            /** @description Free-text notes. The agent may use them for personalization. */
            notes?: string | null;
            /** @description Tags on the contact. */
            tag_ids?: string[];
        };
        /**
         * @description The legal basis for emailing this contact.
         * @enum {string}
         */
        ConsentBasis: "legitimate_interest" | "consent" | "existing_relationship" | "unknown";
        /** @description The fields to change. Fields left out stay as they are. */
        UpdateContact: {
            /**
             * Format: email
             * @description A new email address. Verification runs again.
             */
            email?: string;
            /**
             * @description Given name.
             * @example Priya
             */
            first_name?: string | null;
            /**
             * @description Family name.
             * @example Natarajan
             */
            last_name?: string | null;
            /**
             * @description Job title.
             * @example VP Operations
             */
            title?: string | null;
            /** @description Phone number, free text. */
            phone?: string | null;
            /** @description LinkedIn profile URL. */
            linkedin_url?: string | null;
            company_id?: string | null;
            /** @description City, used to infer the timezone. */
            city?: string | null;
            /**
             * @description ISO 3166-1 alpha-2 country code.
             * @example US
             */
            country?: string | null;
            /**
             * @description IANA timezone. Inferred from city and country when null.
             * @example America/Los_Angeles
             */
            timezone?: string | null;
            lifecycle_stage?: components["schemas"]["LifecycleStage"];
            owner_user_id?: string | null;
            consent_basis?: components["schemas"]["ConsentBasis"];
            /** @description When true the contact is never emailed, whatever its subscription status. */
            do_not_contact?: boolean;
            /**
             * @description Custom field values to change, by key. A null value removes the key; keys left out keep their values.
             * @example {
             *       "industry": "SaaS",
             *       "seats": null
             *     }
             */
            custom_fields?: {
                [key: string]: unknown;
            };
            /** @description Free-text notes. The agent may use them for personalization. */
            notes?: string | null;
            /** @description Tags on the contact. */
            tag_ids?: string[];
        };
        UpsertContacts: {
            /** @description The contacts, at most 1,000. Each needs an `email`. */
            contacts: components["schemas"]["CreateContact"][];
            /** @description What to do with addresses that already exist. Defaults to skip. */
            dedupe_strategy?: components["schemas"]["DedupeStrategy"];
        };
        /**
         * @description What to do when a contact with the same email already exists.
         * @enum {string}
         */
        DedupeStrategy: "skip" | "fill_empty" | "overwrite";
        /** @description A bulk action and the contacts it applies to. */
        ContactBulkActionRequest: {
            action: components["schemas"]["ContactBulkAction"];
            /** @description The contacts to act on, at most 1,000. Give this or `filter`. */
            contact_ids?: string[];
            /** @description A filter AST (§12.2) selecting the contacts, at most 5,000 of them. Give this or `contact_ids`. */
            filter?: {
                [key: string]: unknown;
            };
            /** @description For `tag` and `untag`. */
            tag_ids?: string[];
            /**
             * @description For `add_to_list` and `remove_from_list`: a static list.
             * @example lst_01jd3x5k8qf7tb9w2m4n6p8r0s
             */
            list_id?: string;
            owner_user_id?: string | null;
            /** @description For `set_lifecycle_stage`. */
            lifecycle_stage?: components["schemas"]["LifecycleStage"];
            /** @description For `suppress`: why, in words. */
            note?: string;
        };
        /**
         * @description What to do to every selected contact.
         * @enum {string}
         */
        ContactBulkAction: "tag" | "untag" | "add_to_list" | "remove_from_list" | "set_owner" | "set_lifecycle_stage" | "verify" | "suppress" | "delete" | "export";
        MergeContacts: {
            /**
             * @description The duplicate to merge into this contact. It is deleted afterwards.
             * @example ctc_01jd3x5k8qf7tb9w2m4n6p8r0s
             */
            merge_contact_id: string;
            /** @description Fields whose value should come from the merged contact even where this contact has one. Empty fields are always filled from it. */
            take_from_merged?: ("first_name" | "last_name" | "title" | "phone" | "linkedin_url" | "company_id" | "city" | "country" | "timezone" | "owner_user_id" | "notes")[];
        };
        ContactNote: {
            /**
             * @description The note.
             * @example Met Priya at SaaStr; she owns onboarding.
             */
            text: string;
        };
        CreateImport: {
            /**
             * @description The file name, for the record.
             * @example webinar.csv
             */
            filename: string;
            /** @description The CSV text, with a header row. Comma, semicolon, tab or pipe separated. */
            content: string;
        };
        /** @description How to apply the file. */
        ImportOptions: {
            mapping: components["schemas"]["ColumnMapping"];
            /** @description What to do with addresses that already exist. Defaults to skip. */
            dedupe_strategy?: components["schemas"]["DedupeStrategy"];
            /** @description Tags every imported contact gets. */
            tag_ids?: string[];
            /**
             * @description A static list every imported contact is added to.
             * @example lst_01jd3x5k8qf7tb9w2m4n6p8r0s
             */
            list_id?: string;
            /** @description Legal basis recorded on new contacts. Defaults to unknown. */
            consent_basis?: components["schemas"]["ConsentBasis"];
            /**
             * @description Owner of new contacts.
             * @example usr_01jd3x5k8qf7tb9w2m4n6p8r0s
             */
            owner_user_id?: string;
        };
        /**
         * @description Which contact field each column of the file fills, by column header. Columns left out are skipped.
         * @example {
         *       "Email": "email",
         *       "Name": "full_name",
         *       "Company": "company",
         *       "Industry": "custom.industry",
         *       "Notes": null
         *     }
         */
        ColumnMapping: {
            [key: string]: string | null;
        };
        /** @description A new company. Only `name` is required. */
        CreateCompany: {
            /**
             * @description Company name.
             * @example Globex
             */
            name: string;
            domain?: string | null;
            /**
             * @description Website URL.
             * @example https://globex.com
             */
            website?: string | null;
            /**
             * @description Industry, free text.
             * @example SaaS
             */
            industry?: string | null;
            /**
             * @description Head-count band, free text.
             * @example 200-500
             */
            employee_range?: string | null;
            /**
             * @description ISO 3166-1 alpha-2 country code.
             * @example US
             */
            country?: string | null;
            /** @description Free-text notes. The agent may use them for personalization. */
            notes?: string | null;
            /**
             * @description Values of the custom fields defined for companies, by field key.
             * @example {
             *       "tier": "enterprise"
             *     }
             */
            custom_fields?: {
                [key: string]: unknown;
            };
        };
        /** @description The fields to change. Fields left out stay as they are. */
        UpdateCompany: {
            /**
             * @description Company name.
             * @example Globex
             */
            name?: string;
            domain?: string | null;
            /**
             * @description Website URL.
             * @example https://globex.com
             */
            website?: string | null;
            /**
             * @description Industry, free text.
             * @example SaaS
             */
            industry?: string | null;
            /**
             * @description Head-count band, free text.
             * @example 200-500
             */
            employee_range?: string | null;
            /**
             * @description ISO 3166-1 alpha-2 country code.
             * @example US
             */
            country?: string | null;
            /** @description Free-text notes. The agent may use them for personalization. */
            notes?: string | null;
            /**
             * @description Values of the custom fields defined for companies, by field key.
             * @example {
             *       "tier": "enterprise"
             *     }
             */
            custom_fields?: {
                [key: string]: unknown;
            };
        };
        CreateTag: {
            /**
             * @description Tag name, unique in the workspace.
             * @example saas
             */
            name: string;
            /** @description Display color; defaults to gray. */
            color?: string;
        };
        /**
         * @description How a list decides its members.
         * @enum {string}
         */
        ListKind: "static" | "dynamic";
        CreateList: {
            /**
             * @description List name.
             * @example Webinar attendees
             */
            name: string;
            kind: components["schemas"]["ListKind"];
            /** @description Required for a dynamic list; not allowed on a static one. */
            filter?: components["schemas"]["ContactFilter"];
            /** @description Initial members of a static list, at most 1,000. */
            contact_ids?: string[];
        };
        /**
         * @description A filter AST (§12.2). A condition is `{field, op, value}`; groups are `{and: [...]}`, `{or: [...]}` and `{not: ...}`, nested up to 6 deep with at most 50 conditions. Fields: contact columns (`email`, `first_name`, `lifecycle_stage`, `last_contacted_at`, …), `tag_id`, `list_id` and `custom.<key>`. Operators: eq, neq, in, not_in, contains, starts_with, ends_with, gt, gte, lt, lte, is_null, is_not_null. Timestamps accept ISO-8601 or a relative age such as `-30d` (30 days ago), so saved segments stay current.
         * @example {
         *       "and": [
         *         {
         *           "field": "lifecycle_stage",
         *           "op": "in",
         *           "value": [
         *             "lead",
         *             "prospect"
         *           ]
         *         },
         *         {
         *           "field": "custom.industry",
         *           "op": "eq",
         *           "value": "SaaS"
         *         }
         *       ]
         *     }
         */
        ContactFilter: {
            [key: string]: unknown;
        };
        /** @description The fields to change. A list cannot change between static and dynamic. */
        UpdateList: {
            /** @description List name. */
            name?: string;
            /** @description A new segment filter. Dynamic lists only. */
            filter?: components["schemas"]["ContactFilter"];
        };
        ListMembers: {
            /** @description Contacts to act on, at most 1,000. */
            contact_ids: string[];
        };
        PreviewSegment: {
            filter: components["schemas"]["ContactFilter"];
        };
        /**
         * @description Which records a custom field belongs to.
         * @enum {string}
         */
        CustomFieldEntity: "contact" | "company";
        CreateCustomField: {
            entity: components["schemas"]["CustomFieldEntity"];
            /**
             * @description The key, unique for the entity: lower-case letters, digits and underscores.
             * @example industry
             */
            key: string;
            /**
             * @description Name shown in the UI.
             * @example Industry
             */
            label: string;
            type: components["schemas"]["CustomFieldType"];
            /** @description The allowed values; required for a `select` field and not allowed on others. */
            options?: string[];
            /** @description Whether a value must be given. Defaults to false. */
            required?: boolean;
        };
        /**
         * @description What values a custom field holds. Values are checked on every write.
         * @enum {string}
         */
        CustomFieldType: "text" | "number" | "date" | "boolean" | "select" | "url";
        /** @description The key, entity and type of a field cannot change; create a new field instead. */
        UpdateCustomField: {
            /** @description Name shown in the UI. */
            label?: string;
            /** @description The allowed values; required for a `select` field and not allowed on others. */
            options?: string[];
            /** @description Whether a value must be given. */
            required?: boolean;
        };
        /**
         * @description Why an address or domain is suppressed.
         * @enum {string}
         */
        SuppressionReason: "unsubscribed" | "hard_bounce" | "complaint" | "manual" | "do_not_contact" | "erased";
        CreateSuppression: {
            /**
             * Format: email
             * @description An address to suppress. Give `email` or `domain`, not both.
             * @example priya@globex.com
             */
            email?: string;
            /**
             * @description A whole domain to suppress, such as a competitor or an existing customer. Give `email` or `domain`, not both.
             * @example globex.com
             */
            domain?: string;
            /**
             * @description Why. The other reasons are recorded by Catalyst itself.
             * @enum {string}
             */
            reason?: "manual" | "do_not_contact";
            /** @description Why it was added, in words. */
            note?: string;
        };
        /**
         * @description Where the campaign stands (§5.1).
         * @enum {string}
         */
        CampaignStatus: "draft" | "active" | "paused" | "completed" | "archived";
        CreateCampaign: {
            /** @description Campaign name. */
            name: string;
            /** @description The plain-language business objective. */
            objective: string;
            /** @description Notes for people. */
            description?: string;
            persona?: components["schemas"]["Persona"];
            /** @description Goals in order: the first is goal 1, the last is the final goal. */
            goals?: components["schemas"]["CreateGoal"][];
            /** @description The first variant of the initial email. */
            initial_email?: {
                /** @description Subject template. */
                subject_template: string;
                /** @description Body template. */
                body_template: string;
            };
            /** @description Links the agent may use, by key. */
            links?: {
                [key: string]: string;
            };
            /**
             * @description Who writes replies and AI follow-ups: Catalyst’s agent (default), or your own through the API and MCP (§10.7).
             * @enum {string}
             */
            agent_mode?: "built_in" | "external";
        };
        /** @description The voice the agent writes in. */
        Persona: {
            /** @description Who the sender is, e.g. "Founder". Fills {{ sender.title }}. */
            sender_role?: string | null;
            /** @description How the agent should sound, e.g. "warm, direct, no jargon". */
            tone?: string | null;
            /** @description Default language (BCP-47); replies match the contact’s. */
            language?: string | null;
            /** @description More guidance on style. */
            style_notes?: string | null;
            /** @description How emails end, e.g. "Best, Alex". */
            sign_off?: string | null;
        };
        /** @description A new goal, added after the existing ones. */
        CreateGoal: {
            /**
             * @description A slug used by integration events, e.g. call_booked.
             * @example call_booked
             */
            key: string;
            /**
             * @description Shown as "⟨name⟩ achieved".
             * @example Discovery call booked
             */
            name: string;
            /**
             * @description When the goal counts as met, in words; the AI checks replies against it.
             * @example The contact books a call through the booking link or agrees a specific time.
             */
            success_criteria: string;
            /**
             * @description How the agent moves a contact toward this goal.
             * @example Answer briefly, then offer the booking link; propose two time windows if they prefer email.
             */
            playbook: string;
            /** @description How the goal can be detected. */
            detection_methods?: components["schemas"]["DetectionMethod"][];
            /** @description Which integration event achieves it, e.g. {"source":"calcom","type":"BOOKING_CREATED"}. */
            external_event_match?: {
                [key: string]: string;
            } | null;
            /** @description The key in campaign links whose clicks signal this goal. */
            tracked_link_key?: string | null;
            /** @description A click on the tracked link achieves the goal by itself. */
            click_counts_as_achieved?: boolean;
            /** @description The agent may confirm it alone above the campaign’s threshold. */
            auto_confirm?: boolean;
            /** @description Lifecycle stage the contact moves to when achieved. */
            lifecycle_stage_on_achieve?: components["schemas"]["LifecycleStage"] | null;
            /** @description Achieving it makes the contact a customer (final goals only). */
            marks_customer?: boolean;
            /** @description Estimated value in cents, for attribution. */
            value_cents?: number | null;
        };
        /**
         * @description A way a goal may be detected.
         * @enum {string}
         */
        DetectionMethod: "ai" | "external_event" | "link_click" | "manual";
        UpdateCampaign: {
            /**
             * @description Campaign name.
             * @example Agency outreach Q4
             */
            name?: string;
            /** @description Notes for people. */
            description?: string | null;
            /**
             * @description The plain-language business objective the agent works toward.
             * @example Book discovery calls with heads of operations at 50–500 person SaaS companies.
             */
            objective?: string;
            owner_user_id?: string | null;
            autonomy?: components["schemas"]["Autonomy"];
            persona?: components["schemas"]["Persona"];
            /** @description Campaign-wide rules for the agent. */
            agent_instructions?: string | null;
            sending_window?: components["schemas"]["SendingWindow"];
            /** @description Dates on which nothing is sent. */
            blackout_dates?: string[];
            /**
             * @description New first-touch emails per day, all mailboxes together.
             * @example 30
             */
            daily_new_threads_limit?: number;
            sending_priority?: components["schemas"]["SendingPriority"];
            /** @description For a stage with no sequence: business days to wait after the last message before its finish rule. */
            final_wait_business_days?: number;
            /** @description Add the open-tracking pixel. */
            open_tracking?: boolean;
            /** @description Track opens on the initial email too. */
            track_first_touch?: boolean;
            /** @description Rewrite links to track clicks. Off by default: rewritten links hurt deliverability. */
            click_tracking?: boolean;
            /** @description Send List-Unsubscribe headers (one-click unsubscribe). */
            list_unsubscribe_header?: boolean;
            /** @description Add the one-line compliance footer. */
            unsubscribe_footer?: boolean;
            /** @description Minutes without a bounce after which an email counts as received. */
            delivery_grace_minutes?: number;
            /** @description Shortest wait before an AI reply goes out. */
            reply_delay_min_minutes?: number;
            /** @description Longest wait before an AI reply goes out. */
            reply_delay_max_minutes?: number;
            /** @description Draft confidence needed to auto-send in assisted mode. */
            auto_send_min_confidence?: number;
            /** @description Probability needed to confirm a goal without a person. */
            goal_auto_confirm_threshold?: number;
            /** @description AI replies per thread before a person takes over. */
            max_ai_replies_per_thread?: number;
            /** @description Pause the agent on a thread when you reply from your own mail client. */
            pause_on_manual_reply?: boolean;
            /**
             * @description What happens when a contact clearly declines.
             * @enum {string}
             */
            on_not_interested?: "close_silently" | "send_polite_close";
            /** @description How many AI-personalized first emails need approval before the rest send on their own. */
            review_first_n_personalized?: number;
            enrollment_rules?: components["schemas"]["EnrollmentRules"];
            /**
             * @description Links the agent may use, by key; templates use {{ campaign.links.<key> }}.
             * @example {
             *       "booking": "https://cal.com/acme/intro"
             *     }
             */
            links?: {
                [key: string]: string;
            };
            /**
             * @description Who writes the AI replies (§10.7).
             * @enum {string}
             */
            agent_mode?: "built_in" | "external";
        };
        /**
         * @description How much the agent may send without a person (§10.7).
         * @enum {string}
         */
        Autonomy: "manual" | "assisted" | "autonomous";
        /** @description When emails may go out, in each contact’s own timezone (§8.4). */
        SendingWindow: {
            /**
             * @description Open weekdays, 1 = Monday … 7 = Sunday.
             * @example [
             *       1,
             *       2,
             *       3,
             *       4,
             *       5
             *     ]
             */
            days: number[];
            /**
             * @description Opening time, HH:MM, in the contact’s timezone.
             * @example 08:30
             */
            start: string;
            /**
             * @description Closing time, HH:MM.
             * @example 17:30
             */
            end: string;
            /**
             * @description IANA timezone used when a contact’s timezone is unknown.
             * @example America/New_York
             */
            fallback_tz: string;
        };
        /**
         * @description This campaign’s share of mailboxes it shares with other campaigns (§8.3.3).
         * @enum {string}
         */
        SendingPriority: "high" | "normal" | "low";
        /** @description Who is skipped when contacts are enrolled (§8.5). */
        EnrollmentRules: {
            /** @description Skip contacts with an active thread in another campaign. */
            skip_active_elsewhere?: boolean;
            /** @description Skip contacts emailed by any campaign within this many days. */
            cooldown_days?: number;
            /** @description Enroll role accounts such as info@. */
            allow_role_accounts?: boolean;
            /** @description Enroll addresses verification marked risky or catch-all. */
            allow_risky?: boolean;
        };
        UpdateGoal: {
            /**
             * @description A slug used by integration events, e.g. call_booked.
             * @example call_booked
             */
            key?: string;
            /**
             * @description Shown as "⟨name⟩ achieved".
             * @example Discovery call booked
             */
            name?: string;
            /**
             * @description When the goal counts as met, in words; the AI checks replies against it.
             * @example The contact books a call through the booking link or agrees a specific time.
             */
            success_criteria?: string;
            /** @description How the goal can be detected. */
            detection_methods?: components["schemas"]["DetectionMethod"][];
            /** @description Which integration event achieves it, e.g. {"source":"calcom","type":"BOOKING_CREATED"}. */
            external_event_match?: {
                [key: string]: string;
            } | null;
            /** @description The key in campaign links whose clicks signal this goal. */
            tracked_link_key?: string | null;
            /** @description A click on the tracked link achieves the goal by itself. */
            click_counts_as_achieved?: boolean;
            /** @description The agent may confirm it alone above the campaign’s threshold. */
            auto_confirm?: boolean;
            /**
             * @description How the agent moves a contact toward this goal.
             * @example Answer briefly, then offer the booking link; propose two time windows if they prefer email.
             */
            playbook?: string;
            /** @description Lifecycle stage the contact moves to when achieved. */
            lifecycle_stage_on_achieve?: components["schemas"]["LifecycleStage"] | null;
            /** @description Achieving it makes the contact a customer (final goals only). */
            marks_customer?: boolean;
            /** @description Estimated value in cents, for attribution. */
            value_cents?: number | null;
        };
        ReorderGoals: {
            /** @description Every goal, in the new order. */
            goal_ids: string[];
        };
        UpdateInitialEmail: {
            mode: components["schemas"]["StepMode"];
            /** @description Guidance for AI modes. */
            ai_guidance?: string | null;
            /** @description Null inherits the campaign setting. */
            include_tracking?: boolean | null;
        };
        /**
         * @description How a step’s message is written (§5.10).
         * @enum {string}
         */
        StepMode: "template" | "ai_opening_line" | "ai_adapt" | "ai_write";
        CreateFollowUpSequence: {
            /** @description Name, e.g. "No reply to the first email". */
            name: string;
            /** @description Stages covered: sent, received, responded or goal:<key>. Never the final goal. */
            stages: string[];
            finish?: components["schemas"]["FinishRule"];
            /** @description Wait after the last step before the finish rule. */
            final_wait?: components["schemas"]["Wait"];
            /** @description The steps, in order. */
            steps: components["schemas"]["StepInput"][];
        };
        /**
         * @description What happens after the last step and the final wait.
         * @enum {string}
         */
        FinishRule: "exhaust" | "notify_owner" | "close_lost" | "keep_waiting";
        /** @description A wait before a follow-up. At least 24 hours. */
        Wait: {
            /**
             * @description How long.
             * @example 3
             */
            amount: number;
            /**
             * @description The unit.
             * @enum {string}
             */
            unit: "hours" | "days" | "business_days";
        };
        StepInput: {
            /** @description How long to wait before sending, at least 24 hours. */
            wait: components["schemas"]["Wait"];
            /**
             * @description What the wait counts from; defaults to last_message.
             * @enum {string}
             */
            wait_from?: "last_message" | "goal_event";
            /** @description Defaults to true. */
            send_as_reply?: boolean;
            mode?: components["schemas"]["StepMode"];
            /** @description Guidance for AI modes. */
            ai_guidance?: string | null;
            /** @description Null inherits the campaign setting. */
            include_tracking?: boolean | null;
            /** @description The step’s first variant. */
            variant: components["schemas"]["VariantInput"];
        };
        VariantInput: {
            /** @description Defaults to the next letter. */
            label?: string;
            /** @description Share of traffic; defaults to 1. */
            weight?: number;
            /** @description Subject template. */
            subject_template?: string | null;
            /**
             * @description Body template.
             * @example Hi {{ contact.first_name | default: "there" }},
             *
             *     …
             */
            body_template: string;
            /** @description Defaults to true. */
            active?: boolean;
        };
        UpdateFollowUpSequence: {
            /** @description Name, e.g. "No reply to the first email". */
            name?: string;
            /** @description Stages covered: sent, received, responded or goal:<key>. Never the final goal. */
            stages?: string[];
            finish?: components["schemas"]["FinishRule"];
            /** @description Wait after the last step before the finish rule. */
            final_wait?: components["schemas"]["Wait"];
            /** @description Whether it runs. */
            active?: boolean;
        };
        UpdateFollowUpStep: {
            /** @description How long to wait before sending, at least 24 hours. */
            wait?: components["schemas"]["Wait"];
            /**
             * @description What the wait counts from; defaults to last_message.
             * @enum {string}
             */
            wait_from?: "last_message" | "goal_event";
            /** @description Defaults to true. */
            send_as_reply?: boolean;
            mode?: components["schemas"]["StepMode"];
            /** @description Guidance for AI modes. */
            ai_guidance?: string | null;
            /** @description Null inherits the campaign setting. */
            include_tracking?: boolean | null;
        };
        ReorderSteps: {
            /** @description Every step, in the new order. */
            step_ids: string[];
        };
        UpdateVariant: {
            /** @description Defaults to the next letter. */
            label?: string;
            /** @description Share of traffic; defaults to 1. */
            weight?: number;
            /** @description Subject template. */
            subject_template?: string | null;
            /**
             * @description Body template.
             * @example Hi {{ contact.first_name | default: "there" }},
             *
             *     …
             */
            body_template?: string;
            /** @description Defaults to true. */
            active?: boolean;
        };
        PreviewStep: {
            /**
             * @description Render for this contact.
             * @example ctc_01jd3x5k8qf7tb9w2m4n6p8r0s
             */
            contact_id?: string;
            /**
             * @description Render for this thread’s contact.
             * @example thr_01jd3x5k8qf7tb9w2m4n6p8r0s
             */
            thread_id?: string;
            /**
             * @description Which variant; defaults to the first active one.
             * @example var_01jd3x5k8qf7tb9w2m4n6p8r0s
             */
            variant_id?: string;
        };
        CampaignMailboxes: {
            /** @description The mailboxes, each at most once. */
            mailboxes: {
                /**
                 * @description ID of the mailbox (prefix `mbx_`).
                 * @example mbx_01jd3x5k8qf7tb9w2m4n6p8r0s
                 */
                mailbox_id: string;
                /** @description Relative share; defaults to 1. */
                weight?: number;
            }[];
        };
        EnrollContacts: {
            /** @description Contacts to enroll. Give this or list_id. */
            contact_ids?: string[];
            /**
             * @description A list or segment to enroll, at most 5,000 contacts. Give this or contact_ids.
             * @example lst_01jd3x5k8qf7tb9w2m4n6p8r0s
             */
            list_id?: string;
        };
        /**
         * @description Progress on the status ladder (§5.3). Never goes backwards on its own.
         * @enum {string}
         */
        ThreadStage: "queued" | "sent" | "received" | "responded" | "goal_achieved";
        /**
         * @description The thread’s operational condition (§5.4), separate from its stage.
         * @enum {string}
         */
        ThreadState: "active" | "pending_approval" | "needs_human" | "paused" | "completed" | "exhausted" | "closed_lost" | "bounced" | "unsubscribed" | "stopped";
        /**
         * @description Whether the emails were opened (§5.8). A signal, never exact.
         * @enum {string}
         */
        OpenStatus: "not_tracked" | "unopened" | "machine_only" | "opened";
        UpdateThread: {
            assigned_user_id?: string | null;
            /** @description true: you take over and the agent stops writing on this thread. */
            ai_paused?: boolean;
        };
        MarkGoalAchieved: {
            /** @description The evidence, e.g. "Booked by phone". */
            note?: string;
            /**
             * Format: date-time
             * @description When the goal’s event happens, such as the booked call’s start.
             * @example 2026-11-10T17:52:00Z
             */
            event_at?: string;
        };
        SetStageFloor: {
            /**
             * @description The floor. Goals are marked with markGoalAchieved.
             * @enum {string}
             */
            stage: "queued" | "sent" | "received" | "responded";
            /**
             * @description Why, in words. Logged with the change.
             * @example They booked by phone
             */
            reason: string;
        };
        CloseThread: {
            /**
             * @description Why it is closed.
             * @enum {string}
             */
            reason: "not_interested" | "wrong_person" | "went_quiet" | "manual";
            /** @description More detail, for the timeline. */
            note?: string;
            /** @description Also unsubscribe and suppress the contact everywhere. */
            unsubscribe?: boolean;
        };
        RescheduleNextAction: {
            /**
             * Format: date-time
             * @description The new time, later than now and than the current due time.
             * @example 2026-11-10T17:52:00Z
             */
            at: string;
        };
        /**
         * @description How soon (§11.1). A missed SLA raises it one level.
         * @enum {string}
         */
        EscalationPriority: "urgent" | "high" | "normal";
        /**
         * @description Why a person is needed (§11.1).
         * @enum {string}
         */
        EscalationReason: "knowledge_gap" | "pricing_negotiation" | "legal_or_compliance" | "human_requested" | "identity_question" | "complaint" | "high_value" | "meeting_logistics" | "attachment_received" | "new_participant" | "referral" | "goal_confirmation" | "low_confidence" | "guardrail_failed" | "suspicious_content" | "reply_limit" | "reopened" | "ai_unavailable" | "send_failure" | "unmatched_reply" | "went_quiet" | "custom_rule";
        /**
         * @description Whether a mailbox sends.
         * @enum {string}
         */
        MailboxStatus: "pending" | "active" | "paused" | "error";
        /** @description A new mailbox. It stays pending until testMailboxConnection passes. */
        CreateMailbox: {
            /**
             * Format: email
             * @description The sending address. Its domain must already be added with createDomain.
             * @example alex@getacme.com
             */
            email: string;
            /**
             * @description The mail provider; fills in hosts, ports and folders.
             * @enum {string}
             */
            provider: "google" | "microsoft" | "other";
            /** @description The password or app password. Write-only: stored encrypted, never returned. */
            password: string;
            /** @description SMTP host; required for provider other. */
            smtp_host?: string;
            /** @description SMTP port; 465 or 587. */
            smtp_port?: number;
            /**
             * @description How SMTP is secured.
             * @enum {string}
             */
            smtp_secure?: "tls" | "starttls";
            /** @description SMTP username; defaults to the email address. */
            smtp_username?: string;
            /** @description IMAP host; required for provider other. */
            imap_host?: string;
            /** @description IMAP port; defaults to 993. */
            imap_port?: number;
            /** @description IMAP username; defaults to the SMTP username. */
            imap_username?: string;
            /**
             * @description Most emails a day once warmed up. Above 150 needs an admin (`settings:manage`).
             * @example 40
             */
            daily_limit?: number;
            /**
             * @description Most emails an hour.
             * @example 12
             */
            hourly_limit?: number;
            /**
             * @description Shortest gap between two sends, in seconds (at least 60).
             * @example 120
             */
            min_interval_sec?: number;
            /**
             * @description Longest gap between two sends, in seconds.
             * @example 420
             */
            max_interval_sec?: number;
            /** @description Whether the daily cap ramps up from the start volume. Cannot be turned off in the first 14 days. */
            warmup_enabled?: boolean;
            /**
             * @description Emails on the first warm-up day.
             * @example 10
             */
            warmup_start_volume?: number;
            /**
             * @description How much the warm-up cap grows per Healthy day.
             * @example 5
             */
            warmup_daily_increment?: number;
            /**
             * @description The sender name recipients see.
             * @example Alex Rivera
             */
            display_name: string;
            /** @description Plain-text signature appended to every email. */
            signature_text?: string | null;
            owner_user_id?: string | null;
        };
        /** @description The fields to change. Hosts and the address cannot change; add a new mailbox instead. */
        UpdateMailbox: {
            /**
             * @description Most emails a day once warmed up. Above 150 needs an admin (`settings:manage`).
             * @example 40
             */
            daily_limit?: number;
            /**
             * @description Most emails an hour.
             * @example 12
             */
            hourly_limit?: number;
            /**
             * @description Shortest gap between two sends, in seconds (at least 60).
             * @example 120
             */
            min_interval_sec?: number;
            /**
             * @description Longest gap between two sends, in seconds.
             * @example 420
             */
            max_interval_sec?: number;
            /** @description Whether the daily cap ramps up from the start volume. Cannot be turned off in the first 14 days. */
            warmup_enabled?: boolean;
            /**
             * @description Emails on the first warm-up day.
             * @example 10
             */
            warmup_start_volume?: number;
            /**
             * @description How much the warm-up cap grows per Healthy day.
             * @example 5
             */
            warmup_daily_increment?: number;
            /**
             * @description The sender name recipients see.
             * @example Alex Rivera
             */
            display_name?: string;
            /** @description Plain-text signature appended to every email. */
            signature_text?: string | null;
            owner_user_id?: string | null;
            /** @description A new password. The mailbox goes back to pending until the connection test passes again. */
            password?: string;
        };
        PauseMailbox: {
            /** @description Why, shown on the mailbox. */
            reason?: string;
        };
        ResumeMailbox: {
            /** @description Required (true) when a circuit breaker paused the mailbox. */
            acknowledge_cause?: boolean;
        };
        CreateMailboxDkimKey: {
            /**
             * @description The selector to publish under; `catalyst` by default.
             * @example catalyst
             */
            selector?: string;
        };
        CreateDomain: {
            /**
             * @description The domain to send from. A separate look-alike domain is recommended (§8.1).
             * @example globex.com
             */
            domain: string;
            /**
             * @description A host on the sending domain for open and click tracking, e.g. go.getacme.com.
             * @example globex.com
             */
            tracking_host?: string;
            /**
             * @description The starting ramp plan. Established and custom plans are set by an admin with updateDomainRamp.
             * @enum {string}
             */
            ramp_plan?: "new_domain" | "aged_domain";
            /** @description DKIM selectors, when the provider’s defaults don’t apply. */
            dkim_selectors?: string[];
        };
        ResumeDomainFirstTouches: {
            /** @description Required: true. */
            acknowledge_cause?: boolean;
        };
        UpdateDomainRamp: {
            plan: components["schemas"]["RampPlan"];
            /** @description Required for the custom plan: steps 0, 1, 2 … with caps, none more than 50% above the one before. */
            custom_schedule?: {
                step: number;
                cap: number;
            }[];
            /**
             * @description Why, for the audit log and the Events tab.
             * @example List quality check after the Monday bounce spike
             */
            reason: string;
        };
        /**
         * @description How a domain’s daily cap grows (§8.3.1).
         * @enum {string}
         */
        RampPlan: "new_domain" | "aged_domain" | "established" | "custom";
        RampAction: {
            /**
             * @description Why, for the audit log and the Events tab.
             * @example List quality check after the Monday bounce spike
             */
            reason: string;
        };
        StepBackDomainRamp: {
            /** @description How many steps to drop back. Defaults to 1. */
            steps?: number;
            /**
             * @description Why, for the audit log and the Events tab.
             * @example List quality check after the Monday bounce spike
             */
            reason: string;
        };
        SetDomainCapOverride: {
            /** @description The daily cap to use instead of the ramp step’s. Raising is limited to 50% above the current step. */
            cap: number;
            /**
             * Format: date
             * @description The last day the override applies (workspace timezone), at most 14 days ahead.
             * @example 2026-11-20
             */
            until: string;
            /**
             * @description Why, for the audit log and the Events tab.
             * @example List quality check after the Monday bounce spike
             */
            reason: string;
        };
        /**
         * @description An event an endpoint can subscribe to (§13.6).
         * @enum {string}
         */
        WebhookEventType: "thread.stage_changed" | "thread.state_changed" | "thread.goal_achieved" | "thread.classified" | "message.sent" | "message.received" | "message.opened" | "message.bounced" | "draft.pending_approval" | "escalation.created" | "escalation.resolved" | "contact.created" | "contact.unsubscribed" | "campaign.status_changed" | "mailbox.health_changed" | "mailbox.poll_failed" | "deliverability.breaker_tripped" | "domain.reputation_changed" | "domain.ramp_changed";
        /**
         * @description Where events come from.
         * @enum {string}
         */
        IntegrationKind: "stripe" | "calcom" | "calendly" | "generic";
        /**
         * @description What came of it.
         * @enum {string}
         */
        IntegrationOutcome: "matched" | "already_achieved" | "no_contact" | "no_goal" | "not_sent" | "ignored";
        /**
         * @description What kind of fact.
         * @enum {string}
         */
        KnowledgeKind: "product" | "pricing" | "faq" | "objection" | "policy" | "case_study" | "link" | "other";
        /**
         * @description Who may see it.
         * @enum {string}
         */
        KnowledgeVisibility: "shareable" | "internal";
        /** @description When escalation SLAs run, in the workspace timezone (§11.1). */
        BusinessHours: {
            /** @description ISO weekdays: 1 = Monday … 7 = Sunday. */
            days: number[];
            /** @description `HH:MM`, 24-hour. */
            start: string;
            /** @description `HH:MM`, 24-hour. */
            end: string;
        };
        /** @description When high-priority mail waits until morning; urgent mail still goes (§11.2). May span midnight. */
        QuietHours: {
            /** @description `HH:MM`, 24-hour. */
            start: string;
            /** @description `HH:MM`, 24-hour. */
            end: string;
        };
        /**
         * @description A Claude task (§10.1).
         * @enum {string}
         */
        ClaudeTask: "analyze_inbound" | "draft_reply" | "draft_follow_up" | "personalize" | "summarize" | "kb_test";
        /**
         * @description How much the model thinks (`output_config.effort`).
         * @enum {string}
         */
        Effort: "low" | "medium" | "high" | "xhigh" | "max";
        /**
         * @description Whether AI-written email says so (§10.9). Whatever the setting, the agent never claims to be a person.
         * @enum {string}
         */
        AiDisclosure: "none" | "signature_line";
        /**
         * @description A §10.4 classification threshold (§22.B).
         * @enum {string}
         */
        ClassificationThreshold: "unsubscribeAct" | "unsubscribeAsk" | "autoReply" | "needsReplyDraft" | "needsReplyNone" | "mandatoryEscalate" | "otherEscalate" | "escalationFlag" | "goalAsk" | "notInterestedClose" | "notInterestedAsk" | "notNow" | "autoSendIntent";
        /**
         * @description Role of a signed-in user (§16).
         * @enum {string}
         */
        UserRole: "owner" | "admin" | "member" | "viewer";
        CreateApiKey: {
            /**
             * @description What it is for.
             * @example Claude Code (draft only)
             */
            name: string;
            /** @description What it may do. */
            scopes: components["schemas"]["Scope"][];
            /**
             * Format: date-time
             * @description When it stops working; never, if left out.
             */
            expires_at?: string;
        };
        /**
         * @description A permission carried by an API key. Each operation lists the scopes it needs in `x-required-scopes`.
         * @enum {string}
         */
        Scope: "contacts:read" | "contacts:write" | "contacts:erase" | "campaigns:read" | "campaigns:write" | "threads:read" | "threads:write" | "messages:send" | "escalations:read" | "escalations:write" | "knowledge:read" | "knowledge:write" | "mailboxes:read" | "mailboxes:write" | "analytics:read" | "webhooks:manage" | "settings:manage";
        CreatePushSubscription: {
            /**
             * Format: uri
             * @description The push service URL.
             */
            endpoint: string;
            keys: {
                /** @description The browser’s P-256 public key, base64url. */
                p256dh: string;
                /** @description Its 16-byte auth secret, base64url. */
                auth: string;
            };
            /** @description Ignored; browsers resubscribe when it changes. */
            expirationTime?: number | null;
        };
        /**
         * @description Error response (RFC 9457).
         * @example {
         *       "type": "https://catalyst.example.com/problems/validation_failed",
         *       "title": "Validation failed",
         *       "status": 400,
         *       "code": "validation_failed",
         *       "errors": [
         *         {
         *           "path": "body.email",
         *           "message": "Not a valid email address"
         *         }
         *       ]
         *     }
         */
        Problem: {
            /** @description URI identifying the problem type. */
            type: string;
            /** @description Short summary of the problem type. */
            title: string;
            /** @description The HTTP status code. */
            status: number;
            /** @description What went wrong in this particular request. */
            detail?: string;
            /** @description The request ID, for support. */
            instance?: string;
            code: components["schemas"]["ProblemCode"];
            /** @description Per-field details. */
            errors?: {
                /** @description The field or parameter at fault, e.g. `body.email`. */
                path: string;
                message: string;
                /** @description For `send_blocked`: the check that failed. */
                reason?: string;
            }[];
        };
        /**
         * @description Stable machine-readable error code.
         * @enum {string}
         */
        ProblemCode: "validation_failed" | "unauthorized" | "forbidden_scope" | "not_found" | "conflict" | "precondition_failed" | "idempotency_key_reused" | "rate_limited" | "preflight_failed" | "send_blocked" | "thread_terminal" | "stage_already_covered" | "poll_in_progress" | "mailbox_auth_failed" | "dns_check_failed" | "ai_unavailable" | "budget_exceeded" | "two_factor_required" | "internal_error";
        /** @description Who is calling, and what they may do. */
        Principal: {
            /**
             * @description What kind of caller this is.
             * @enum {string}
             */
            kind: "user" | "api_key";
            /**
             * @description The user ID (`usr_…`) or API key ID (`key_…`).
             * @example key_01jd3x5k8qf7tb9w2m4n6p8r0s
             */
            id: string;
            /**
             * @description The user's name or the key's label.
             * @example Claude Code (draft only)
             */
            name: string;
            /** @description Role of the user; null for an API key. */
            role: components["schemas"]["UserRole"] | null;
            /** @description What this caller may do. For a user, the scopes its role grants. */
            scopes: components["schemas"]["Scope"][];
            workspace: {
                /**
                 * @description ID of the workspace (prefix `wsp_`).
                 * @example wsp_01jd3x5k8qf7tb9w2m4n6p8r0s
                 */
                id: string;
                /**
                 * @description Workspace name.
                 * @example Acme
                 */
                name: string;
            };
            /** @description An owner of a workspace that requires two-factor sign-in, who hasn’t set it up: every other operation answers 403 `two_factor_required` until they do (§16). */
            two_factor_required: boolean;
        };
        WorkQueue: {
            items: components["schemas"]["WorkItem"][];
            /** @description How many of each kind are waiting in all. */
            counts: {
                escalation: number;
                draft: number;
                unmatched_reply: number;
                mailbox: number;
                reply_needed: number;
                follow_up_needed: number;
            };
        };
        WorkItem: {
            /**
             * @description What kind of item.
             * @enum {string}
             */
            kind: "escalation" | "draft" | "unmatched_reply" | "mailbox" | "reply_needed" | "follow_up_needed";
            /** @description The escalation, email, mailbox or (for `reply_needed` and `follow_up_needed`) thread ID, depending on `kind`. */
            id: string;
            /**
             * @description How soon it needs a person.
             * @enum {string}
             */
            priority: "urgent" | "high" | "normal";
            /** @description In a few words. */
            title: string;
            /** @description Why it needs a person, in plain language. */
            why: string;
            thread_id: string | null;
            contact_id: string | null;
            /** @description When it is due (escalations), if it has a deadline. */
            due_at: string | null;
            /**
             * Format: date-time
             * @description Since when it has been waiting.
             */
            created_at: string;
            /** @description MCP tools that settle it, in the order you would use them. */
            suggested_tools: string[];
        };
        Job: {
            id: string;
            /**
             * @description What it is.
             * @enum {string}
             */
            kind: "import" | "mailbox_poll";
            /**
             * @description Where it stands.
             * @enum {string}
             */
            status: "queued" | "running" | "succeeded" | "failed";
            /** @description How far along, when it can tell. */
            progress: {
                done: number;
                total: number | null;
            } | null;
            error: string | null;
            /** Format: date-time */
            created_at: string;
            finished_at: string | null;
        };
        SearchResults: {
            /** @description Results, best first. */
            data: components["schemas"]["SearchResult"][];
        };
        SearchResult: {
            /**
             * @description What the result is.
             * @enum {string}
             */
            kind: "contact" | "company" | "thread" | "campaign";
            /**
             * @description Its ID.
             * @example ctc_01jd3x5k8qf7tb9w2m4n6p8r0s
             */
            id: string;
            /**
             * @description The main line to show.
             * @example Priya Natarajan
             */
            title: string;
            /**
             * @description A second line with context.
             * @example VP Operations · priya@globex.com
             */
            subtitle: string | null;
        };
        /** @description One page of contact results. */
        ContactPage: {
            data: components["schemas"]["Contact"][];
            /** @description Pass as `cursor` to get the next page; null on the last page. */
            next_cursor: string | null;
        };
        /** @description A person Catalyst can email. Unique per workspace by email address. */
        Contact: {
            /**
             * @description ID of the contact (prefix `ctc_`).
             * @example ctc_01jd3x5k8qf7tb9w2m4n6p8r0s
             */
            id: string;
            /**
             * Format: email
             * @description Email address, lower-cased. Unique in the workspace.
             * @example priya@globex.com
             */
            email: string;
            /**
             * @description Given name.
             * @example Priya
             */
            first_name: string | null;
            /**
             * @description Family name.
             * @example Natarajan
             */
            last_name: string | null;
            /**
             * @description Job title.
             * @example VP Operations
             */
            title: string | null;
            /** @description Phone number, free text. */
            phone: string | null;
            /** @description LinkedIn profile URL. */
            linkedin_url: string | null;
            company_id: string | null;
            /** @description City, used to infer the timezone. */
            city: string | null;
            /**
             * @description ISO 3166-1 alpha-2 country code.
             * @example US
             */
            country: string | null;
            /**
             * @description IANA timezone. Inferred from city and country when null.
             * @example America/Los_Angeles
             */
            timezone: string | null;
            lifecycle_stage: components["schemas"]["LifecycleStage"];
            owner_user_id: string | null;
            consent_basis: components["schemas"]["ConsentBasis"];
            /** @description When true the contact is never emailed, whatever its subscription status. */
            do_not_contact: boolean;
            /**
             * @description Values of the custom fields defined for contacts, by field key.
             * @example {
             *       "industry": "SaaS"
             *     }
             */
            custom_fields: {
                [key: string]: unknown;
            };
            /** @description Free-text notes. The agent may use them for personalization. */
            notes: string | null;
            /** @description Tags on the contact. */
            tag_ids: string[];
            /**
             * @description How the contact was created: manual, import, api, referral or thread_participant.
             * @example import
             */
            source: string;
            /** @description More about the source, such as the import file name. */
            source_detail: string | null;
            email_verification: components["schemas"]["EmailVerification"];
            email_verified_at: string | null;
            /** @description Flags from verification: role, freemail, disposable, typo_suspect. */
            email_flags: string[];
            subscription_status: components["schemas"]["SubscriptionStatus"];
            unsubscribed_at: string | null;
            last_contacted_at: string | null;
            last_replied_at: string | null;
            last_opened_at: string | null;
            /**
             * Format: date-time
             * @description When the contact was created.
             * @example 2026-11-10T17:52:00Z
             */
            created_at: string;
            /**
             * Format: date-time
             * @description When the contact last changed.
             * @example 2026-11-10T17:52:00Z
             */
            updated_at: string;
        };
        UpsertResult: {
            /** @description Contacts created. */
            created: number;
            /** @description Existing contacts changed. */
            updated: number;
            /** @description Rows left alone: existing contacts under `skip`, unchanged ones, and repeats of an earlier row. */
            skipped: number;
            /** @description One entry per row, in request order. */
            results: {
                /** @description Position of the row in the request. */
                index: number;
                /**
                 * @description The contact the row created or matched.
                 * @example ctc_01jd3x5k8qf7tb9w2m4n6p8r0s
                 */
                contact_id: string;
                /**
                 * @description What happened to this row.
                 * @enum {string}
                 */
                action: "created" | "updated" | "unchanged" | "skipped" | "duplicate_in_request";
            }[];
        };
        ContactBulkActionResult: {
            action: components["schemas"]["ContactBulkAction"];
            /** @description How many contacts were selected. */
            matched: number;
            /** @description How many were actually changed (or exported). */
            changed: number;
            /** @description Selected contacts that were left alone, and why. */
            skipped: {
                /** @description The contact. */
                contact_id: string;
                /** @description Why it was skipped. */
                reason: string;
            }[];
            /** @description For `export`: the contacts as CSV with a header row; null otherwise. */
            csv: string | null;
        };
        /** @description One page of activity results. */
        ActivityPage: {
            data: components["schemas"]["Activity"][];
            /** @description Pass as `cursor` to get the next page; null on the last page. */
            next_cursor: string | null;
        };
        /** @description One entry in a contact or thread timeline. */
        Activity: {
            /**
             * @description ID of the activity (prefix `act_`).
             * @example act_01jd3x5k8qf7tb9w2m4n6p8r0s
             */
            id: string;
            /**
             * @description What happened, e.g. `thread.stage_changed` or `contact.note_added` (§22.C).
             * @example contact.note_added
             */
            type: string;
            actor_type: components["schemas"]["ActorType"];
            /** @description The user, API key or integration behind it, when there is one. */
            actor_id: string | null;
            contact_id: string | null;
            thread_id: string | null;
            campaign_id: string | null;
            /** @description Details, depending on the type: `{from, to}` for changes, `{text}` for notes. */
            data: {
                [key: string]: unknown;
            };
            /**
             * Format: date-time
             * @description When it happened.
             * @example 2026-11-10T17:52:00Z
             */
            occurred_at: string;
        };
        /**
         * @description Who caused an activity.
         * @enum {string}
         */
        ActorType: "system" | "ai" | "user" | "api_key" | "contact" | "integration";
        VerificationResult: {
            contact: components["schemas"]["Contact"];
            /**
             * @description A likely intended address when the domain looks mistyped.
             * @example priya@gmail.com
             */
            suggestion: string | null;
            /** @description What each check found, in words. */
            details: string[];
        };
        /** @description Everything Catalyst holds about one contact, for a data-access request. */
        ContactExport: {
            /**
             * Format: date-time
             * @description When the export was made.
             */
            exported_at: string;
            contact: components["schemas"]["Contact"];
            /** @description Tags on the contact. */
            tags: {
                id: string;
                name: string;
            }[];
            /** @description Static lists the contact is in. */
            lists: {
                id: string;
                name: string;
            }[];
            /** @description Every conversation with the contact, with its messages. */
            threads: {
                [key: string]: unknown;
            }[];
            /** @description The contact’s full timeline. */
            activities: {
                [key: string]: unknown;
            }[];
            /** @description Suppressions that apply to the contact’s address or domain. */
            suppressions: {
                [key: string]: unknown;
            }[];
        };
        /** @description One page of duplicategroup results. */
        DuplicateGroupPage: {
            data: components["schemas"]["DuplicateGroup"][];
            /** @description Pass as `cursor` to get the next page; null on the last page. */
            next_cursor: string | null;
        };
        DuplicateGroup: {
            /**
             * @description Why these contacts look like the same person.
             * @enum {string}
             */
            reason: "same_name_and_company" | "similar_email";
            /** @description The contacts in the group, oldest first. */
            contacts: components["schemas"]["Contact"][];
        };
        /** @description An uploaded contact file and what became of it. */
        Import: {
            /**
             * @description ID of the import (prefix `imp_`).
             * @example imp_01jd3x5k8qf7tb9w2m4n6p8r0s
             */
            id: string;
            /**
             * @description Name of the uploaded file.
             * @example webinar.csv
             */
            filename: string;
            /**
             * @description Where the import stands.
             * @enum {string}
             */
            status: "uploaded" | "mapped" | "processing" | "done" | "failed";
            /** @description The column headers of the file, in order. */
            headers: string[];
            /** @description The first 5 data rows, for checking the mapping. */
            sample_rows: string[][];
            /** @description A mapping guessed from the headers and samples. */
            suggested_mapping: components["schemas"]["ColumnMapping"];
            /** @description The mapping last previewed or committed. */
            mapping: components["schemas"]["ColumnMapping"] | null;
            dedupe_strategy: components["schemas"]["DedupeStrategy"];
            /** @description Tags given to every imported contact. */
            tag_ids: string[];
            /** @description The static list contacts are added to. */
            list_id: string | null;
            /** @description Data rows in the file. */
            total_rows: number;
            /** @description Rows handled so far while processing. */
            processed_rows: number;
            /** @description Contacts created. */
            created_count: number;
            /** @description Existing contacts changed. */
            updated_count: number;
            /** @description Rows not imported: existing contacts left alone, suppressed addresses and repeats. */
            skipped_count: number;
            /** @description Rows with problems. */
            error_count: number;
            /** @description Row problems, up to 1,000, for the error report. */
            errors: components["schemas"]["ImportError"][];
            /**
             * Format: date-time
             * @description When the file was uploaded.
             * @example 2026-11-10T17:52:00Z
             */
            created_at: string;
            finished_at: string | null;
        };
        ImportError: {
            /** @description Row number in the file; the header is row 1. */
            row: number;
            /** @description The column at fault, if one is. */
            column: string | null;
            /** @description What is wrong. */
            message: string;
        };
        /** @description What committing the import would do (a dry run). */
        ImportSummary: {
            /** @description Rows that would create a contact. */
            new: number;
            /** @description Rows that match an existing contact and would change it. */
            update: number;
            /** @description Rows that match an existing contact and leave it alone (dedupe strategy skip). */
            skip: number;
            /** @description Rows with a problem; they are not imported. */
            invalid: number;
            /** @description Rows whose address or domain is suppressed; they are not imported. */
            suppressed: number;
            /** @description Rows repeating an address that appears earlier in the file; the first one wins. */
            duplicates_in_file: number;
            /** @description The first 100 problems. */
            errors: components["schemas"]["ImportError"][];
        };
        /** @description One page of company results. */
        CompanyPage: {
            data: components["schemas"]["Company"][];
            /** @description Pass as `cursor` to get the next page; null on the last page. */
            next_cursor: string | null;
        };
        /** @description An organisation that contacts belong to. */
        Company: {
            /**
             * @description ID of the company (prefix `co_`).
             * @example co_01jd3x5k8qf7tb9w2m4n6p8r0s
             */
            id: string;
            /**
             * @description Company name.
             * @example Globex
             */
            name: string;
            domain: string | null;
            /**
             * @description Website URL.
             * @example https://globex.com
             */
            website: string | null;
            /**
             * @description Industry, free text.
             * @example SaaS
             */
            industry: string | null;
            /**
             * @description Head-count band, free text.
             * @example 200-500
             */
            employee_range: string | null;
            /**
             * @description ISO 3166-1 alpha-2 country code.
             * @example US
             */
            country: string | null;
            /** @description Free-text notes. The agent may use them for personalization. */
            notes: string | null;
            /**
             * @description Values of the custom fields defined for companies, by field key.
             * @example {
             *       "tier": "enterprise"
             *     }
             */
            custom_fields: {
                [key: string]: unknown;
            };
            /** @description How many contacts belong to the company. */
            contact_count: number;
            /**
             * Format: date-time
             * @description When the company was created.
             * @example 2026-11-10T17:52:00Z
             */
            created_at: string;
            /**
             * Format: date-time
             * @description When the company last changed.
             * @example 2026-11-10T17:52:00Z
             */
            updated_at: string;
        };
        /** @description One page of tag results. */
        TagPage: {
            data: components["schemas"]["Tag"][];
            /** @description Pass as `cursor` to get the next page; null on the last page. */
            next_cursor: string | null;
        };
        /** @description A label that can be put on contacts. */
        Tag: {
            /**
             * @description ID of the tag (prefix `tag_`).
             * @example tag_01jd3x5k8qf7tb9w2m4n6p8r0s
             */
            id: string;
            /**
             * @description Tag name, unique in the workspace.
             * @example saas
             */
            name: string;
            /**
             * @description Display color.
             * @example gray
             */
            color: string;
        };
        /** @description One page of list results. */
        ListPage: {
            data: components["schemas"]["List"][];
            /** @description Pass as `cursor` to get the next page; null on the last page. */
            next_cursor: string | null;
        };
        /** @description A static list of contacts, or a dynamic segment defined by a filter. */
        List: {
            /**
             * @description ID of the list (prefix `lst_`).
             * @example lst_01jd3x5k8qf7tb9w2m4n6p8r0s
             */
            id: string;
            /**
             * @description List name.
             * @example Webinar attendees
             */
            name: string;
            kind: components["schemas"]["ListKind"];
            /** @description The segment filter of a dynamic list; null for a static list. */
            filter: components["schemas"]["ContactFilter"] | null;
            /** @description How many (non-deleted) contacts are in the list right now. */
            member_count: number;
            created_by: string | null;
            /**
             * Format: date-time
             * @description When the list was created.
             * @example 2026-11-10T17:52:00Z
             */
            created_at: string;
            /**
             * Format: date-time
             * @description When the list last changed.
             * @example 2026-11-10T17:52:00Z
             */
            updated_at: string;
        };
        /** @description The result of a membership change. */
        ListMembersAdded: {
            /** @description How many contacts were added. */
            changed: number;
            /** @description How many were already members. */
            unchanged: number;
        };
        /** @description The result of a membership change. */
        ListMembersRemoved: {
            /** @description How many contacts were removed. */
            changed: number;
            /** @description How many were not members. */
            unchanged: number;
        };
        SegmentPreview: {
            /** @description How many contacts match. */
            count: number;
            /** @description Up to 10 matching contacts, newest first. */
            sample: components["schemas"]["Contact"][];
        };
        /** @description One page of customfield results. */
        CustomFieldPage: {
            data: components["schemas"]["CustomField"][];
            /** @description Pass as `cursor` to get the next page; null on the last page. */
            next_cursor: string | null;
        };
        /** @description A typed field defined for contacts or companies. */
        CustomField: {
            /**
             * @description ID of the custom field (prefix `cfd_`).
             * @example cfd_01jd3x5k8qf7tb9w2m4n6p8r0s
             */
            id: string;
            entity: components["schemas"]["CustomFieldEntity"];
            /**
             * @description The key used in `custom_fields`, in filters (`custom.<key>`) and in templates (`{{contact.custom.<key>}}`).
             * @example industry
             */
            key: string;
            /**
             * @description Name shown in the UI.
             * @example Industry
             */
            label: string;
            type: components["schemas"]["CustomFieldType"];
            /**
             * @description The allowed values of a `select` field; null for other types.
             * @example [
             *       "SaaS",
             *       "Agency",
             *       "E-commerce"
             *     ]
             */
            options: string[] | null;
            /** @description A new record must give a value, and the value can never be cleared. */
            required: boolean;
        };
        /** @description One page of suppression results. */
        SuppressionPage: {
            data: components["schemas"]["Suppression"][];
            /** @description Pass as `cursor` to get the next page; null on the last page. */
            next_cursor: string | null;
        };
        /** @description An address or domain that must never be emailed, in any campaign or by any send path. */
        Suppression: {
            /**
             * @description ID of the suppression (prefix `sup_`).
             * @example sup_01jd3x5k8qf7tb9w2m4n6p8r0s
             */
            id: string;
            /**
             * @description The suppressed address; null for a domain suppression, or after the contact was erased.
             * @example priya@globex.com
             */
            email: string | null;
            /**
             * @description The suppressed domain; null for an address suppression.
             * @example null
             */
            domain: string | null;
            /** @description True when only the hash of the address is kept (after erasure). The block still applies. */
            hashed_only: boolean;
            reason: components["schemas"]["SuppressionReason"];
            /**
             * @description Where it came from: link, one_click, reply, bounce, complaint, manual, import or api.
             * @example api
             */
            source: string;
            /** @description Why it was added, in words. */
            note: string | null;
            created_by: string | null;
            /**
             * Format: date-time
             * @description When it was added.
             * @example 2026-11-10T17:52:00Z
             */
            created_at: string;
        };
        SuppressionCheck: {
            /** @description The address checked, lower-cased. */
            email: string;
            /** @description True when Catalyst will not email this address. */
            blocked: boolean;
            /** @description Why it is blocked; empty when it is not. */
            reasons: ("suppressed" | "unsubscribed" | "bounced" | "invalid" | "do_not_contact")[];
            /** @description The suppressions that match. */
            suppressions: components["schemas"]["Suppression"][];
            contact_id: string | null;
        };
        /** @description One page of campaign results. */
        CampaignPage: {
            data: components["schemas"]["Campaign"][];
            /** @description Pass as `cursor` to get the next page; null on the last page. */
            next_cursor: string | null;
        };
        /** @description Goals, emails, follow-ups, agent settings and the threads for its contacts (§5.1). */
        Campaign: {
            /**
             * @description ID of the campaign (prefix `cmp_`).
             * @example cmp_01jd3x5k8qf7tb9w2m4n6p8r0s
             */
            id: string;
            status: components["schemas"]["CampaignStatus"];
            /**
             * @description Campaign name.
             * @example Agency outreach Q4
             */
            name: string;
            /** @description Notes for people. */
            description: string | null;
            /**
             * @description The plain-language business objective the agent works toward.
             * @example Book discovery calls with heads of operations at 50–500 person SaaS companies.
             */
            objective: string;
            owner_user_id: string | null;
            autonomy: components["schemas"]["Autonomy"];
            persona: components["schemas"]["Persona"];
            /** @description Campaign-wide rules for the agent. */
            agent_instructions: string | null;
            sending_window: components["schemas"]["SendingWindow"];
            /** @description Dates on which nothing is sent. */
            blackout_dates: string[];
            /**
             * @description New first-touch emails per day, all mailboxes together.
             * @example 30
             */
            daily_new_threads_limit: number;
            sending_priority: components["schemas"]["SendingPriority"];
            /** @description For a stage with no sequence: business days to wait after the last message before its finish rule. */
            final_wait_business_days: number;
            /** @description Add the open-tracking pixel. */
            open_tracking: boolean;
            /** @description Track opens on the initial email too. */
            track_first_touch: boolean;
            /** @description Rewrite links to track clicks. Off by default: rewritten links hurt deliverability. */
            click_tracking: boolean;
            /** @description Send List-Unsubscribe headers (one-click unsubscribe). */
            list_unsubscribe_header: boolean;
            /** @description Add the one-line compliance footer. */
            unsubscribe_footer: boolean;
            /** @description Minutes without a bounce after which an email counts as received. */
            delivery_grace_minutes: number;
            /** @description Shortest wait before an AI reply goes out. */
            reply_delay_min_minutes: number;
            /** @description Longest wait before an AI reply goes out. */
            reply_delay_max_minutes: number;
            /** @description Draft confidence needed to auto-send in assisted mode. */
            auto_send_min_confidence: number;
            /** @description Probability needed to confirm a goal without a person. */
            goal_auto_confirm_threshold: number;
            /** @description AI replies per thread before a person takes over. */
            max_ai_replies_per_thread: number;
            /** @description Pause the agent on a thread when you reply from your own mail client. */
            pause_on_manual_reply: boolean;
            /**
             * @description What happens when a contact clearly declines.
             * @enum {string}
             */
            on_not_interested: "close_silently" | "send_polite_close";
            /** @description How many AI-personalized first emails need approval before the rest send on their own. */
            review_first_n_personalized: number;
            enrollment_rules: components["schemas"]["EnrollmentRules"];
            /**
             * @description Links the agent may use, by key; templates use {{ campaign.links.<key> }}.
             * @example {
             *       "booking": "https://cal.com/acme/intro"
             *     }
             */
            links: {
                [key: string]: string;
            };
            /**
             * @description Who writes the AI replies (§10.7).
             * @enum {string}
             */
            agent_mode: "built_in" | "external";
            /** @description The mailboxes it sends from, with their weights. */
            mailboxes: {
                /**
                 * @description ID of the mailbox (prefix `mbx_`).
                 * @example mbx_01jd3x5k8qf7tb9w2m4n6p8r0s
                 */
                mailbox_id: string;
                weight: number;
            }[];
            /** @description How many goals it has. */
            goal_count: number;
            /** @description How many contacts are enrolled. */
            thread_count: number;
            launched_at: string | null;
            completed_at: string | null;
            archived_at: string | null;
            /**
             * Format: date-time
             * @description When it was created.
             * @example 2026-11-10T17:52:00Z
             */
            created_at: string;
            /**
             * Format: date-time
             * @description When it last changed.
             * @example 2026-11-10T17:52:00Z
             */
            updated_at: string;
        };
        /** @description The launch gate (§8.11). */
        Preflight: {
            /** @description No item failed, so the campaign can launch. */
            passed: boolean;
            items: components["schemas"]["PreflightItem"][];
            /** @description Who the campaign would reach. */
            audience: {
                enrollable: number;
                enrolled: number;
                /** @description Enrolled threads that would be skipped now, by reason. */
                skipped: {
                    [key: string]: number;
                };
            };
        };
        PreflightItem: {
            /**
             * @description A stable identifier for the check.
             * @example initial_email
             */
            id: string;
            /**
             * @description The result.
             * @enum {string}
             */
            status: "pass" | "warn" | "fail";
            /** @description What was checked. */
            title: string;
            /** @description What was found, and how to fix it. */
            detail: string | null;
        };
        /** @description A campaign’s goals in order. */
        GoalList: {
            data: components["schemas"]["Goal"][];
        };
        /** @description An ordered milestone in a campaign (§5.2). Achieving goal k implies goals 1…k−1. */
        Goal: {
            /**
             * @description ID of the goal (prefix `gol_`).
             * @example gol_01jd3x5k8qf7tb9w2m4n6p8r0s
             */
            id: string;
            /** @description 1 for the first goal; the highest is the final goal. */
            position: number;
            /**
             * @description A slug used by integration events, e.g. call_booked.
             * @example call_booked
             */
            key: string;
            /**
             * @description Shown as "⟨name⟩ achieved".
             * @example Discovery call booked
             */
            name: string;
            /**
             * @description When the goal counts as met, in words; the AI checks replies against it.
             * @example The contact books a call through the booking link or agrees a specific time.
             */
            success_criteria: string;
            /** @description How the goal can be detected. */
            detection_methods: components["schemas"]["DetectionMethod"][];
            /** @description Which integration event achieves it, e.g. {"source":"calcom","type":"BOOKING_CREATED"}. */
            external_event_match: {
                [key: string]: string;
            } | null;
            /** @description The key in campaign links whose clicks signal this goal. */
            tracked_link_key: string | null;
            /** @description A click on the tracked link achieves the goal by itself. */
            click_counts_as_achieved: boolean;
            /** @description The agent may confirm it alone above the campaign’s threshold. */
            auto_confirm: boolean;
            /**
             * @description How the agent moves a contact toward this goal.
             * @example Answer briefly, then offer the booking link; propose two time windows if they prefer email.
             */
            playbook: string;
            /** @description Lifecycle stage the contact moves to when achieved. */
            lifecycle_stage_on_achieve: components["schemas"]["LifecycleStage"] | null;
            /** @description Achieving it makes the contact a customer (final goals only). */
            marks_customer: boolean;
            /** @description Estimated value in cents, for attribution. */
            value_cents: number | null;
        };
        /** @description The initial email, or one follow-up step. */
        Step: {
            /**
             * @description ID of the step (prefix `stp_`).
             * @example stp_01jd3x5k8qf7tb9w2m4n6p8r0s
             */
            id: string;
            position: number;
            wait: components["schemas"]["Wait"];
            /**
             * @description What the wait counts from.
             * @enum {string}
             */
            wait_from: "last_message" | "goal_event";
            /** @description Sent as "Re: …" in the same email thread. */
            send_as_reply: boolean;
            mode: components["schemas"]["StepMode"];
            /** @description Guidance for the AI modes. */
            ai_guidance: string | null;
            /** @description Open tracking for this step; null inherits the campaign setting. */
            include_tracking: boolean | null;
            variants: components["schemas"]["Variant"][];
        };
        /** @description One version of a step’s message, for A/B testing. */
        Variant: {
            /**
             * @description ID of the variant (prefix `var_`).
             * @example var_01jd3x5k8qf7tb9w2m4n6p8r0s
             */
            id: string;
            /**
             * @description A, B, …
             * @example A
             */
            label: string;
            /** @description Share of traffic, relative to the other variants. */
            weight: number;
            /** @description Subject; required on the initial email, ignored on follow-ups sent as replies. */
            subject_template: string | null;
            /** @description Plain-text body with template variables. For AI modes, the brief. */
            body_template: string;
            /** @description Inactive variants get no traffic. */
            active: boolean;
            /** @description Template problems found when the variant was read. */
            issues: components["schemas"]["TemplateIssue"][];
        };
        /** @description A template problem; each one blocks sending (§8.7). */
        TemplateIssue: {
            /**
             * @description What is wrong.
             * @enum {string}
             */
            code: "syntax" | "unknown_variable" | "unknown_filter" | "unsupported_tag" | "empty_variable";
            message: string;
            variable?: string;
        };
        FollowUpSequenceList: {
            data: components["schemas"]["FollowUpSequence"][];
            /** @description Each stage that can have follow-ups, in order, with the sequence covering it. */
            stages: {
                stage: string;
                label: string;
                sequence_id: string | null;
            }[];
        };
        /** @description Timed follow-ups sent while waiting on the contact, for the stages it covers (§5.10). */
        FollowUpSequence: {
            /**
             * @description ID of the sequence (prefix `seq_`).
             * @example seq_01jd3x5k8qf7tb9w2m4n6p8r0s
             */
            id: string;
            name: string;
            /**
             * @description Stages covered: sent, received, responded or goal:<key>.
             * @example [
             *       "sent",
             *       "received"
             *     ]
             */
            stages: string[];
            finish: components["schemas"]["FinishRule"];
            final_wait: components["schemas"]["Wait"];
            /** @description Inactive sequences don’t run and don’t cover their stages. */
            active: boolean;
            steps: components["schemas"]["Step"][];
            /**
             * Format: date-time
             * @description When it was created.
             * @example 2026-11-10T17:52:00Z
             */
            created_at: string;
            /**
             * Format: date-time
             * @description When it last changed.
             * @example 2026-11-10T17:52:00Z
             */
            updated_at: string;
        };
        StepPreview: {
            /**
             * @description ID of the variant (prefix `var_`).
             * @example var_01jd3x5k8qf7tb9w2m4n6p8r0s
             */
            variant_id: string;
            /** @description The rendered subject; null when it is sent as a reply or failed to render. */
            subject: string | null;
            /** @description The rendered body, with signature and footer; null when it failed to render. */
            body_text: string | null;
            template_issues: components["schemas"]["TemplateIssue"][];
            /** @description Linter findings (§8.7). */
            lint: components["schemas"]["LintFinding"][];
            /** @description No template issue or lint blocker. */
            sendable: boolean;
            /** @description For AI modes: what the AI would do with this text. */
            note: string | null;
        };
        /** @description One content linter finding (§8.7). */
        LintFinding: {
            /** @description The rule, e.g. `spam_phrase` or `missing_unsubscribe`. */
            rule: string;
            /**
             * @description How serious it is.
             * @enum {string}
             */
            severity: "blocker" | "warning";
            /** @description What is wrong, in words. */
            message: string;
        };
        EnrollmentResult: {
            /** @description Contacts enrolled, with their new threads. */
            created: {
                /**
                 * @description ID of the contact (prefix `ctc_`).
                 * @example ctc_01jd3x5k8qf7tb9w2m4n6p8r0s
                 */
                contact_id: string;
                /**
                 * @description ID of the thread (prefix `thr_`).
                 * @example thr_01jd3x5k8qf7tb9w2m4n6p8r0s
                 */
                thread_id: string;
            }[];
            /** @description Contacts not enrolled, and why (§8.5). */
            skipped: {
                contact_id: string;
                /**
                 * @description Why the contact was skipped.
                 * @enum {string}
                 */
                reason: "not_found" | "already_enrolled" | "suppressed" | "unsubscribed" | "do_not_contact" | "invalid" | "risky" | "role_account" | "active_elsewhere" | "cooldown" | "consent_required";
            }[];
        };
        /** @description One page of thread results. */
        ThreadPage: {
            data: components["schemas"]["Thread"][];
            /** @description Pass as `cursor` to get the next page; null on the last page. */
            next_cursor: string | null;
        };
        /** @description One conversation between one mailbox and one contact in one campaign. */
        Thread: {
            /**
             * @description ID of the thread (prefix `thr_`).
             * @example thr_01jd3x5k8qf7tb9w2m4n6p8r0s
             */
            id: string;
            /** @description The campaign. */
            campaign: {
                /**
                 * @description ID of the campaign (prefix `cmp_`).
                 * @example cmp_01jd3x5k8qf7tb9w2m4n6p8r0s
                 */
                id: string;
                name: string;
            };
            /** @description The contact, in brief. */
            contact: {
                /**
                 * @description ID of the contact (prefix `ctc_`).
                 * @example ctc_01jd3x5k8qf7tb9w2m4n6p8r0s
                 */
                id: string;
                email: string;
                name: string | null;
                company: string | null;
            };
            mailbox_id: string | null;
            stage: components["schemas"]["ThreadStage"];
            /** @description 0 queued, 1 sent, 2 received, 3 responded, 3+k goal k. */
            stage_rank: number;
            /**
             * @description The stage as shown, e.g. "Call booked achieved".
             * @example Responded
             */
            stage_label: string;
            achieved_goal_id: string | null;
            /** @description A stage set by hand without evidence; the stage never shows lower. */
            manual_floor_rank: number;
            state: components["schemas"]["ThreadState"];
            /** @description Why it is in that state, e.g. contact_deleted, no_reply, human_took_over. */
            state_reason: string | null;
            /** @description What happens next (§5.5). */
            next_action: {
                type: components["schemas"]["NextActionType"];
                at: string | null;
                message_id: string | null;
                /** @description Which limit pushed it back (§8.3.5), e.g. domain_ramp or window. */
                throttle_reason: string | null;
            };
            /** @description Follow-up progress (§5.10). */
            follow_up: {
                sequence_id: string | null;
                /** @description The next step to send. */
                step_position: number | null;
                /** @description A person stopped follow-ups on this thread. */
                stopped: boolean;
                waiting_since: string | null;
                /** @description Follow-ups sent so far. */
                sent: number;
                check_in_at: string | null;
            };
            /** @description Open and click tracking, across the thread’s emails. */
            open: {
                status: components["schemas"]["OpenStatus"];
                count: number;
                first_opened_at: string | null;
                last_opened_at: string | null;
                clicked: boolean;
            };
            /** @description The latest conversation classification. */
            classification: {
                /** @description Jev’s top intent for the conversation (§10.4). */
                intent: string | null;
                /** @description Its probability. */
                intent_p: number | null;
                sentiment: string | null;
                /** @description 0 cold, 1 curious, 2 evaluating, 3 ready to buy. */
                temperature: number | null;
                /** @description The last classification came from Claude alone, so nothing auto-sends. */
                fallback: boolean;
            };
            /** @description A person took over; the agent writes nothing. */
            ai_paused: boolean;
            /** @description A person paused the thread. */
            manually_paused: boolean;
            /** @description Why it was last closed. */
            closed_reason: string | null;
            closed_at: string | null;
            /** @description The conversation’s subject. */
            subject: string | null;
            /** @description The AI summary of the conversation. */
            summary: string | null;
            assigned_user_id: string | null;
            /** @description Open escalations; any puts the thread in needs_human. */
            open_escalations: number;
            ai_replies_sent: number;
            first_sent_at: string | null;
            received_at: string | null;
            responded_at: string | null;
            completed_at: string | null;
            last_message_at: string | null;
            last_inbound_at: string | null;
            last_outbound_at: string | null;
            /**
             * Format: date-time
             * @description When the contact was enrolled.
             * @example 2026-11-10T17:52:00Z
             */
            created_at: string;
            /**
             * Format: date-time
             * @description When the thread last changed.
             * @example 2026-11-10T17:52:00Z
             */
            updated_at: string;
        };
        /**
         * @description What happens next on the thread (§5.5).
         * @enum {string}
         */
        NextActionType: "none" | "send_initial" | "send_reply" | "send_follow_up" | "await_reply";
        ThreadContext: {
            /**
             * @description ID of the thread (prefix `thr_`).
             * @example thr_01jd3x5k8qf7tb9w2m4n6p8r0s
             */
            thread_id: string;
            /** @description The whole context as markdown. */
            markdown: string;
            /** @description The only links a reply may use, by key. */
            allowed_links: {
                [key: string]: string;
            };
            /** @description Shareable knowledge for this campaign. */
            kb_items: {
                id: string;
                title: string;
                content: string;
            }[];
            /** @description Autonomy, sending window, reply delay and AI reply limit. */
            constraints: {
                [key: string]: unknown;
            };
        };
        /** @description One page of message results. */
        MessagePage: {
            data: components["schemas"]["Message"][];
            /** @description Pass as `cursor` to get the next page; null on the last page. */
            next_cursor: string | null;
        };
        /** @description One email in a thread. */
        Message: {
            /**
             * @description ID of the message (prefix `msg_`).
             * @example msg_01jd3x5k8qf7tb9w2m4n6p8r0s
             */
            id: string;
            thread_id: string | null;
            /**
             * @description Which way it went.
             * @enum {string}
             */
            direction: "outbound" | "inbound";
            status: components["schemas"]["MessageStatus"];
            author: components["schemas"]["MessageAuthor"];
            match_method: components["schemas"]["MatchMethod"] | null;
            step_id: string | null;
            variant_id: string | null;
            subject: string;
            from_email: string;
            from_name: string | null;
            /** @description Recipients. */
            to_emails: unknown[];
            /** @description The plain-text body. */
            body_text: string | null;
            /** @description Inbound: the reply without quoted history or signature. */
            stripped_text: string | null;
            snippet: string | null;
            has_attachments: boolean;
            scheduled_for: string | null;
            sent_at: string | null;
            received_at: string | null;
            /** @description Inbound: human_reply, auto_reply, out_of_office, bounce_hard, … (§7.5). */
            inbound_kind: string | null;
            open_count: number;
            /** @description A person opened it (not a proxy or scanner). */
            human_open: boolean;
            error: string | null;
            /** @description Outbound: the content linter’s findings when it was written or last edited; null for inbound mail. */
            lint: components["schemas"]["LintFinding"][] | null;
            approved_at: string | null;
            /**
             * Format: date-time
             * @description When it was stored.
             * @example 2026-11-10T17:52:00Z
             */
            created_at: string;
            /**
             * Format: date-time
             * @description When it last changed.
             * @example 2026-11-10T17:52:00Z
             */
            updated_at: string;
        };
        /**
         * @description Where the message stands (§5.7).
         * @enum {string}
         */
        MessageStatus: "draft" | "pending_approval" | "scheduled" | "sending" | "sent" | "bounced" | "failed" | "cancelled" | "superseded" | "send_unknown" | "received";
        /**
         * @description Who wrote it.
         * @enum {string}
         */
        MessageAuthor: "template" | "ai" | "human_app" | "human_external" | "contact" | "third_party" | "system";
        /**
         * @description Inbound: how it was matched to its thread (§7.4).
         * @enum {string}
         */
        MatchMethod: "headers" | "subject_sender" | "sender_fallback" | "dsn_original" | "manual";
        /** @description One page of classification results. */
        ClassificationPage: {
            data: components["schemas"]["Classification"][];
            /** @description Pass as `cursor` to get the next page; null on the last page. */
            next_cursor: string | null;
        };
        Classification: {
            /**
             * @description ID of the AI run (prefix `air_`).
             * @example air_01jd3x5k8qf7tb9w2m4n6p8r0s
             */
            id: string;
            trigger_message_id: string | null;
            /** @description `typesafe` for Jev; `anthropic` for Claude’s analysis, which classifies on its own while Jev is unavailable. */
            provider: string;
            model: string;
            classifier_version: string;
            status: string;
            /** @description The answers with their probabilities. */
            output: {
                [key: string]: unknown;
            } | null;
            /**
             * Format: date-time
             * @description When it ran.
             * @example 2026-11-10T17:52:00Z
             */
            created_at: string;
        };
        LintResult: {
            findings: components["schemas"]["LintFinding"][];
            /** @description No blocker. */
            sendable: boolean;
        };
        /** @description One page of escalation results. */
        EscalationPage: {
            data: components["schemas"]["Escalation"][];
            /** @description Pass as `cursor` to get the next page; null on the last page. */
            next_cursor: string | null;
        };
        /** @description Something that needs a person (§11). */
        Escalation: {
            /**
             * @description ID of the escalation (prefix `esc_`).
             * @example esc_01jd3x5k8qf7tb9w2m4n6p8r0s
             */
            id: string;
            thread_id: string | null;
            contact_id: string | null;
            campaign_id: string | null;
            trigger_message_id: string | null;
            reason: components["schemas"]["EscalationReason"];
            /** @description Every reason that applied; the first is `reason`. */
            reasons: components["schemas"]["EscalationReason"][];
            priority: components["schemas"]["EscalationPriority"];
            /** @description In a few words, e.g. "Asked about SAML SSO". */
            title: string;
            /** @description Why a person is needed, in plain language. */
            explanation: string;
            /** @description For knowledge gaps: the questions the agent couldn’t answer. */
            questions: {
                text: string;
                why_unanswerable: string;
            }[];
            suggested_draft_id: string | null;
            goal_id: string | null;
            /** @description For a goal confirmation: how likely the classifier thinks the goal is reached. */
            goal_p: number | null;
            status: components["schemas"]["EscalationStatus"];
            assigned_user_id: string | null;
            /**
             * Format: date-time
             * @description When its SLA runs out.
             * @example 2026-11-10T17:52:00Z
             */
            due_at: string;
            /** @description Open, and past `due_at`. */
            overdue: boolean;
            snoozed_until: string | null;
            resolution: components["schemas"]["EscalationResolution"] | null;
            /** @description What the person said when settling it. */
            resolution_note: string | null;
            resolved_by: string | null;
            resolved_at: string | null;
            /**
             * Format: date-time
             * @description When it was raised.
             * @example 2026-11-10T17:52:00Z
             */
            created_at: string;
            /**
             * Format: date-time
             * @description When it last changed.
             * @example 2026-11-10T17:52:00Z
             */
            updated_at: string;
        };
        /**
         * @description Where it stands.
         * @enum {string}
         */
        EscalationStatus: "open" | "snoozed" | "resolved" | "dismissed";
        /**
         * @description How it was settled (§11.3).
         * @enum {string}
         */
        EscalationResolution: "replied" | "answered_for_ai" | "goal_confirmed" | "goal_rejected" | "took_over" | "closed_thread" | "dismissed";
        EscalationAnswered: {
            escalation: components["schemas"]["Escalation"];
            draft: components["schemas"]["Message"];
            knowledge_item_id: string | null;
        };
        /** @description One page of mailbox results. */
        MailboxPage: {
            data: components["schemas"]["Mailbox"][];
            /** @description Pass as `cursor` to get the next page; null on the last page. */
            next_cursor: string | null;
        };
        /** @description A sending identity. Credentials are write-only and never returned. */
        Mailbox: {
            /**
             * @description ID of the mailbox (prefix `mbx_`).
             * @example mbx_01jd3x5k8qf7tb9w2m4n6p8r0s
             */
            id: string;
            /**
             * @description The sending address.
             * @example alex@getacme.com
             */
            email: string;
            /**
             * @description The domain the mailbox sends from.
             * @example dom_01jd3x5k8qf7tb9w2m4n6p8r0s
             */
            sending_domain_id: string;
            /**
             * @description The mail provider, from the SMTP host.
             * @enum {string}
             */
            provider: "google" | "microsoft" | "other";
            /**
             * @description How Catalyst signs in.
             * @enum {string}
             */
            auth: "password" | "oauth2_google" | "oauth2_microsoft";
            smtp_host: string;
            smtp_port: number;
            /**
             * @description How the SMTP connection is secured.
             * @enum {string}
             */
            smtp_secure: "tls" | "starttls";
            smtp_username: string;
            imap_host: string;
            imap_port: number;
            imap_username: string;
            /**
             * @description The INBOX, Sent and Junk folders, found by the connection test.
             * @example {
             *       "inbox": "INBOX",
             *       "sent": "[Gmail]/Sent Mail",
             *       "junk": "[Gmail]/Spam"
             *     }
             */
            folders: {
                [key: string]: string;
            };
            status: components["schemas"]["MailboxStatus"];
            /** @description Why it is paused or in error. */
            status_reason: string | null;
            /**
             * @description Most emails a day once warmed up. Above 150 needs an admin (`settings:manage`).
             * @example 40
             */
            daily_limit: number;
            /**
             * @description Most emails an hour.
             * @example 12
             */
            hourly_limit: number;
            /**
             * @description Shortest gap between two sends, in seconds (at least 60).
             * @example 120
             */
            min_interval_sec: number;
            /**
             * @description Longest gap between two sends, in seconds.
             * @example 420
             */
            max_interval_sec: number;
            /** @description Whether the daily cap ramps up from the start volume. Cannot be turned off in the first 14 days. */
            warmup_enabled: boolean;
            /**
             * @description Emails on the first warm-up day.
             * @example 10
             */
            warmup_start_volume: number;
            /**
             * @description How much the warm-up cap grows per Healthy day.
             * @example 5
             */
            warmup_daily_increment: number;
            /**
             * @description The sender name recipients see.
             * @example Alex Rivera
             */
            display_name: string;
            /** @description Plain-text signature appended to every email. */
            signature_text: string | null;
            owner_user_id: string | null;
            /** @description The current warm-up step. */
            warmup_step: number;
            /** @description Today’s own cap: daily limit and warm-up, times the health multiplier. */
            today_cap: number;
            /** @description Mailbox health, 0–100 (§8.10). */
            health_score: number;
            health_band: components["schemas"]["ReputationBand"];
            last_sent_at: string | null;
            last_poll_at: string | null;
            /** @description How the last poll went. */
            last_poll_status: string | null;
            next_poll_at: string | null;
            catalyst_dkim: components["schemas"]["CatalystDkim"] | null;
            /**
             * Format: date-time
             * @description When it was added.
             * @example 2026-11-10T17:52:00Z
             */
            created_at: string;
            /**
             * Format: date-time
             * @description When it last changed.
             * @example 2026-11-10T17:52:00Z
             */
            updated_at: string;
        };
        /**
         * @description A reputation band, from a domain or mailbox score (§8.10).
         * @enum {string}
         */
        ReputationBand: "healthy" | "at_risk" | "critical" | "paused";
        /** @description Catalyst signs this mailbox’s mail with its own DKIM key, for a host that doesn’t sign (§7.1). The private key is never returned. */
        CatalystDkim: {
            /**
             * @description The DKIM selector (`s=`).
             * @example catalyst
             */
            selector: string;
            /**
             * @description Where to publish the public key: a TXT record at this name.
             * @example catalyst._domainkey.getacme.com
             */
            record_name: string;
            /**
             * @description The TXT record’s value.
             * @example v=DKIM1; k=rsa; p=MIIBIjANBgkqh…
             */
            record_value: string;
        };
        ConnectionTest: {
            /** @description Every required step passed; the mailbox is now active. */
            passed: boolean;
            /** @description Each step, in order. */
            steps: {
                /**
                 * @description Which step.
                 * @enum {string}
                 */
                step: "smtp_auth" | "imap_auth" | "folders" | "send" | "receive" | "sent_copy" | "cleanup";
                /**
                 * @description How it went.
                 * @enum {string}
                 */
                status: "pass" | "warn" | "fail" | "skipped";
                /** @description What happened. */
                detail: string | null;
            }[];
            mailbox: components["schemas"]["Mailbox"];
        };
        PollQueued: {
            /**
             * @description ID of the mailbox (prefix `mbx_`).
             * @example mbx_01jd3x5k8qf7tb9w2m4n6p8r0s
             */
            mailbox_id: string;
            /**
             * Format: date-time
             * @description When the poll was queued.
             */
            queued_at: string;
            /** @description When the previous poll finished. */
            last_poll_at: string | null;
        };
        DeliverabilityOverview: {
            domains: {
                /**
                 * @description ID of the domain (prefix `dom_`).
                 * @example dom_01jd3x5k8qf7tb9w2m4n6p8r0s
                 */
                domain_id: string;
                domain: string;
                /** @description Domain reputation, 0–100 (§8.10). */
                reputation_score: number;
                reputation_band: components["schemas"]["ReputationBand"];
                blocklisted: boolean;
                alignment_status: ("aligned" | "not_aligned" | "unknown") | null;
                /** @description The last DNS check, record by record; null before the first. */
                dns: {
                    spf: components["schemas"]["CheckStatus"] | null;
                    dkim: components["schemas"]["CheckStatus"] | null;
                    dmarc: components["schemas"]["CheckStatus"] | null;
                    /** @description none, quarantine or reject. */
                    dmarc_policy: string | null;
                    mx: components["schemas"]["CheckStatus"] | null;
                    tracking: components["schemas"]["CheckStatus"] | null;
                    checked_at: string | null;
                };
                ramp: {
                    plan: components["schemas"]["RampPlan"];
                    step: number;
                    final_step: number;
                    status: components["schemas"]["RampStatus"];
                    /** @description The domain-wide cap today. */
                    today_cap: number;
                    /** @description Tomorrow’s cap if the domain stays Healthy. */
                    tomorrow_cap: number;
                };
            }[];
            mailboxes: {
                /**
                 * @description ID of the mailbox (prefix `mbx_`).
                 * @example mbx_01jd3x5k8qf7tb9w2m4n6p8r0s
                 */
                mailbox_id: string;
                email: string;
                /**
                 * @description ID of the domain (prefix `dom_`).
                 * @example dom_01jd3x5k8qf7tb9w2m4n6p8r0s
                 */
                domain_id: string;
                status: components["schemas"]["MailboxStatus"];
                status_reason: string | null;
                /** @description Mailbox health, 0–100 (§8.10). */
                health_score: number;
                health_band: components["schemas"]["ReputationBand"];
                /** @description Sent today. */
                sent_today: number;
                /** @description Its cap today; 0 unless active. */
                today_cap: number;
                warmup: {
                    enabled: boolean;
                    step: number;
                    final_step: number;
                    complete: boolean;
                };
                last_poll_at: string | null;
                last_poll_status: ("ok" | "partial" | "error") | null;
            }[];
            today: {
                /**
                 * Format: date
                 * @description Today, in the workspace’s timezone.
                 */
                day: string;
                /** @description Domain caps added up. */
                planned: number;
                /** @description Sent today. */
                sent: number;
                /** @description Replies received today. */
                replies: number;
                /** @description What holds sending back most today. */
                main_limit: components["schemas"]["CampaignLimit"] | null;
            };
            /** @description Ramp moves, band changes, breaker trips, pauses and polls, newest first. */
            events: components["schemas"]["Activity"][];
        };
        /**
         * @description The result of one DNS check.
         * @enum {string}
         */
        CheckStatus: "pass" | "warn" | "fail";
        /**
         * @description Where the ramp stands.
         * @enum {string}
         */
        RampStatus: "ramping" | "holding" | "stepped_back" | "complete" | "stopped";
        /**
         * @description What limits the campaign today.
         * @enum {string}
         */
        CampaignLimit: "domain_ramp" | "domain_reputation" | "domain_auth" | "mailbox_cap" | "mailbox_health" | "campaign_share" | "campaign_limit";
        SendingCapacity: {
            /**
             * Format: date
             * @description Today, in the workspace’s timezone.
             */
            day: string;
            domains: {
                /**
                 * @description ID of the domain (prefix `dom_`).
                 * @example dom_01jd3x5k8qf7tb9w2m4n6p8r0s
                 */
                domain_id: string;
                domain: string;
                /** @description The domain-wide cap today. */
                cap: number;
                /** @description What its active mailboxes were given. */
                alloc: number;
                /** @description Composed or sent today. */
                used: number;
            }[];
            mailboxes: {
                /**
                 * @description ID of the mailbox (prefix `mbx_`).
                 * @example mbx_01jd3x5k8qf7tb9w2m4n6p8r0s
                 */
                mailbox_id: string;
                email: string;
                /**
                 * @description ID of the domain (prefix `dom_`).
                 * @example dom_01jd3x5k8qf7tb9w2m4n6p8r0s
                 */
                domain_id: string;
                /** @description Its own cap: daily limit and warm-up, times its health multiplier. */
                cap: number;
                /** @description Its share of the domain’s cap. */
                alloc: number;
                /** @description Held for replies only. */
                reply_reserve: number;
                /** @description The most replies it may send today. */
                reply_limit: number;
                /** @description Follow-ups that fit today. */
                follow_ups: number;
                /** @description Left for first emails. */
                first_touch_pool: number;
                limited_by: components["schemas"]["MailboxLimit"];
                /** @description Composed or sent today. */
                used: {
                    /** @description First emails. */
                    initial: number;
                    /** @description Follow-ups. */
                    follow_ups: number;
                    /** @description Replies. */
                    replies: number;
                };
                campaigns: {
                    /**
                     * @description ID of the campaign (prefix `cmp_`).
                     * @example cmp_01jd3x5k8qf7tb9w2m4n6p8r0s
                     */
                    campaign_id: string;
                    /** @description First emails this campaign may send from it today. */
                    alloc: number;
                }[];
            }[];
            campaigns: {
                /**
                 * @description ID of the campaign (prefix `cmp_`).
                 * @example cmp_01jd3x5k8qf7tb9w2m4n6p8r0s
                 */
                campaign_id: string;
                name: string;
                /**
                 * @description Its sending priority.
                 * @enum {string}
                 */
                priority: "high" | "normal" | "low";
                /** @description Its new-threads-per-day limit. */
                wants: number;
                /** @description First emails it may send today. */
                alloc: number;
                /** @description First emails composed or sent today. */
                used: number;
                /** @description Threads waiting for their first email. */
                waiting: number;
                limited_by: components["schemas"]["CampaignLimit"];
                finishes_on: string | null;
            }[];
            /** @description The next 7 days, if every band stays Healthy. */
            forecast: {
                /**
                 * Format: date
                 * @description The day.
                 */
                day: string;
                domains: {
                    /**
                     * @description ID of the domain (prefix `dom_`).
                     * @example dom_01jd3x5k8qf7tb9w2m4n6p8r0s
                     */
                    domain_id: string;
                    /** @description The projected cap. */
                    cap: number;
                }[];
                campaigns: {
                    /**
                     * @description ID of the campaign (prefix `cmp_`).
                     * @example cmp_01jd3x5k8qf7tb9w2m4n6p8r0s
                     */
                    campaign_id: string;
                    /** @description The projected first emails. */
                    alloc: number;
                }[];
            }[];
        };
        /**
         * @description What limits the mailbox today.
         * @enum {string}
         */
        MailboxLimit: "domain_ramp" | "domain_reputation" | "domain_auth" | "mailbox_cap" | "mailbox_health";
        /** @description One page of pollrun results. */
        PollRunPage: {
            data: components["schemas"]["PollRun"][];
            /** @description Pass as `cursor` to get the next page; null on the last page. */
            next_cursor: string | null;
        };
        PollRun: {
            /**
             * @description ID of the poll run (prefix `prn_`).
             * @example prn_01jd3x5k8qf7tb9w2m4n6p8r0s
             */
            id: string;
            /**
             * @description What started the poll.
             * @enum {string}
             */
            trigger: "schedule" | "manual" | "api" | "catch_up";
            /**
             * @description How it went.
             * @enum {string}
             */
            status: "running" | "ok" | "partial" | "error";
            /**
             * Format: date-time
             * @description When it started.
             * @example 2026-11-10T17:52:00Z
             */
            started_at: string;
            finished_at: string | null;
            /** @description How long it took. */
            duration_ms: number | null;
            /** @description Messages fetched. */
            fetched_count: number;
            /** @description Messages matched to a thread. */
            matched_count: number;
            /** @description Messages ignored (unknown senders). */
            ignored_count: number;
            /** @description What went wrong. */
            error: string | null;
        };
        MailboxStats: {
            /**
             * @description ID of the mailbox (prefix `mbx_`).
             * @example mbx_01jd3x5k8qf7tb9w2m4n6p8r0s
             */
            mailbox_id: string;
            /** @description One row per day with activity, oldest first. */
            days: {
                /** Format: date */
                day: string;
                sent: number;
                new_threads: number;
                replies_sent: number;
                bounced_hard: number;
                bounced_soft: number;
                complaints: number;
                inbound_replies: number;
                opens_human: number;
                unsubscribes: number;
            }[];
            /** @description The same counts summed over the period. */
            totals: {
                [key: string]: number;
            };
            /** @description The inputs of the last health recompute and the points each cost. */
            health_inputs: {
                [key: string]: unknown;
            };
        };
        /** @description One page of domain results. */
        DomainPage: {
            data: components["schemas"]["Domain"][];
            /** @description Pass as `cursor` to get the next page; null on the last page. */
            next_cursor: string | null;
        };
        /** @description A domain Catalyst sends from, with its DNS, reputation and ramp. */
        Domain: {
            /**
             * @description ID of the domain (prefix `dom_`).
             * @example dom_01jd3x5k8qf7tb9w2m4n6p8r0s
             */
            id: string;
            /**
             * @description The sending domain.
             * @example getacme.com
             */
            domain: string;
            /**
             * @description The open and click tracking host, a CNAME on the sending domain.
             * @example go.getacme.com
             */
            tracking_host: string | null;
            /** @description DKIM selectors to check; empty means the mail provider’s defaults. */
            dkim_selectors: string[];
            /** @description The last DNS check; null until the first one. */
            checks: components["schemas"]["DomainChecks"] | null;
            alignment_status: ("aligned" | "not_aligned" | "unknown") | null;
            last_checked_at: string | null;
            /** @description The domain or its sending IP is on a major blocklist. */
            blocklisted: boolean;
            /** @description Gmail’s view of the domain, from Postmaster Tools. Connect with GET /domains/{domainId}/postmaster/connect (signed in). */
            postmaster: {
                /** @description Google Postmaster Tools is connected for the domain (§8.10). */
                connected: boolean;
                synced_at: string | null;
                /**
                 * @description The latest day’s Gmail user-reported spam rate, as a fraction; null with no data.
                 * @example 0.0008
                 */
                spam_rate: number | null;
                /** @description The latest day’s authentication success rates at Gmail, as fractions. */
                auth: {
                    spf: number | null;
                    dkim: number | null;
                    dmarc: number | null;
                };
                /**
                 * @description Gmail’s sender compliance status.
                 * @enum {string}
                 */
                compliance: "compliant" | "needs_work" | "unknown";
                /** @description The requirements Gmail says are unmet, e.g. ONE_CLICK_UNSUBSCRIBE. */
                needs_work: string[];
                /** @description Google shows no data, usually because the domain sends too little to Gmail. Neutral, not good. */
                no_data: boolean;
                /** @description Why the last sync didn’t work. */
                error: string | null;
            };
            /** @description SPF, DKIM or DMARC started failing, so no first emails go from this domain; follow-ups and replies still do (§8.9). Fix the records, check DNS, then resumeDomainFirstTouches. */
            first_touches_paused: {
                /**
                 * Format: date-time
                 * @description When it tripped.
                 * @example 2026-11-10T17:52:00Z
                 */
                since: string;
                /**
                 * @description The records that started failing.
                 * @example dkim
                 */
                reason: string;
            } | null;
            /** @description Domain reputation, 0–100 (§8.10). */
            reputation_score: number;
            reputation_band: components["schemas"]["ReputationBand"];
            ramp: components["schemas"]["DomainRampSummary"];
            /** @description Mailboxes on this domain. */
            mailbox_count: number;
            /**
             * Format: date-time
             * @description When the domain was added.
             * @example 2026-11-10T17:52:00Z
             */
            created_at: string;
        };
        /** @description The last DNS check, record by record. */
        DomainChecks: {
            spf: components["schemas"]["RecordCheck"];
            dkim: components["schemas"]["RecordCheck"];
            dmarc: components["schemas"]["RecordCheck"];
            mx: components["schemas"]["RecordCheck"];
            tracking: components["schemas"]["RecordCheck"];
            /** @description No launch blocker failed (§8.2). */
            ready: boolean;
        };
        RecordCheck: {
            status: components["schemas"]["CheckStatus"];
            /** @description Where the record lives, e.g. `_dmarc.getacme.com`. */
            name: string;
            /** @description What DNS returned. */
            found: string[];
            /** @description What the record should say, to copy into DNS. */
            expected: string;
            /** @description What is wrong, or that it is fine, in words. */
            message: string;
        };
        /** @description The domain’s ramp in brief; getDomainRamp has the schedule and history. */
        DomainRampSummary: {
            plan: components["schemas"]["RampPlan"];
            /** @description The current step. */
            step: number;
            /** @description The step at which the plan reaches its ceiling. */
            final_step: number;
            status: components["schemas"]["RampStatus"];
            /** @description An admin is holding the ramp at this step. */
            manual_hold: boolean;
            /** @description The domain-wide cap for today: the step (or override) times the band multiplier. */
            today_cap: number;
            /** @description A temporary cap set by an admin, replacing the step’s cap until the end date. */
            cap_override: {
                cap: number;
                /** Format: date */
                until: string;
                reason: string | null;
            } | null;
        };
        DomainReputation: {
            /**
             * @description ID of the domain (prefix `dom_`).
             * @example dom_01jd3x5k8qf7tb9w2m4n6p8r0s
             */
            domain_id: string;
            /** @description The current score. */
            score: number;
            band: components["schemas"]["ReputationBand"];
            band_changed_at: string | null;
            /** @description The inputs of the last recompute and the points each cost (§8.10). */
            inputs: {
                [key: string]: unknown;
            };
            /** @description The score per day for the last 30 days, oldest first. */
            history: {
                /** Format: date */
                day: string;
                score: number | null;
                band: string | null;
            }[];
        };
        /** @description A domain’s ramp plan, schedule and history (§8.3). */
        DomainRamp: {
            /**
             * @description ID of the domain (prefix `dom_`).
             * @example dom_01jd3x5k8qf7tb9w2m4n6p8r0s
             */
            domain_id: string;
            plan: components["schemas"]["RampPlan"];
            custom_schedule: {
                step: number;
                cap: number;
            }[] | null;
            /** @description The current step. */
            step: number;
            /** @description The step at which the plan reaches its ceiling. */
            final_step: number;
            status: components["schemas"]["RampStatus"];
            /** @description Why the ramp is where it is. */
            status_reason: string | null;
            /** @description An admin is holding the ramp. */
            manual_hold: boolean;
            /** @description The total of the active mailboxes’ daily limits: where the ramp ends. */
            mailbox_cap_total: number;
            /** @description Today’s domain-wide cap after the band multiplier. */
            today_cap: number;
            /** @description Tomorrow’s cap if the domain stays Healthy and today is a sending day. */
            tomorrow_cap: number;
            /** @description The cap at every step of the plan, up to its ceiling: the active mailboxes’ total. Every cap is 0 while the domain has no active mailbox. */
            schedule: {
                step: number;
                cap: number;
            }[];
            /** @description The temporary cap, if one is set. */
            cap_override: {
                cap: number;
                /** Format: date */
                until: string;
                reason: string | null;
            } | null;
            /** @description Planned and sent volume per day for the last 30 days, oldest first. */
            history: {
                /** Format: date */
                day: string;
                planned_cap: number;
                sent: number;
                ramp_step: number | null;
                ramp_action: string | null;
                reputation_band: string | null;
            }[];
        };
        /** @description One page of webhookendpoint results. */
        WebhookEndpointPage: {
            data: components["schemas"]["WebhookEndpoint"][];
            /** @description Pass as `cursor` to get the next page; null on the last page. */
            next_cursor: string | null;
        };
        /** @description A URL that receives signed event POSTs. */
        WebhookEndpoint: {
            /**
             * @description ID of the webhook endpoint (prefix `whk_`).
             * @example whk_01jd3x5k8qf7tb9w2m4n6p8r0s
             */
            id: string;
            /** @description Where events are POSTed: https, on a public address. */
            url: string;
            description: string | null;
            /** @description The events it receives. */
            events: components["schemas"]["WebhookEventType"][];
            /** @description Receiving events. Turned off by hand, or automatically after 3 days of failures. */
            active: boolean;
            /** @description Failed attempts since the last success. */
            consecutive_failures: number;
            disabled_at: string | null;
            /**
             * Format: date-time
             * @description When it was added.
             * @example 2026-11-10T17:52:00Z
             */
            created_at: string;
        };
        WebhookEndpointCreated: {
            /**
             * @description ID of the webhook endpoint (prefix `whk_`).
             * @example whk_01jd3x5k8qf7tb9w2m4n6p8r0s
             */
            id: string;
            /** @description Where events are POSTed: https, on a public address. */
            url: string;
            description: string | null;
            /** @description The events it receives. */
            events: components["schemas"]["WebhookEventType"][];
            /** @description Receiving events. Turned off by hand, or automatically after 3 days of failures. */
            active: boolean;
            /** @description Failed attempts since the last success. */
            consecutive_failures: number;
            disabled_at: string | null;
            /**
             * Format: date-time
             * @description When it was added.
             * @example 2026-11-10T17:52:00Z
             */
            created_at: string;
            /** @description The signing secret, shown only now. */
            secret: string;
        };
        /** @description One event sent to one endpoint, with its attempts. */
        WebhookDelivery: {
            /**
             * @description ID of the webhook delivery (prefix `whd_`).
             * @example whd_01jd3x5k8qf7tb9w2m4n6p8r0s
             */
            id: string;
            /**
             * @description ID of the webhook endpoint (prefix `whk_`).
             * @example whk_01jd3x5k8qf7tb9w2m4n6p8r0s
             */
            endpoint_id: string;
            /** @description The event’s `evt_` ID, the same for every endpoint. */
            event_id: string;
            /** @description The event type, or `webhook.test` for a test. */
            event_type: string;
            /** @description Attempts made so far. */
            attempt: number;
            /**
             * @description Where it stands.
             * @enum {string}
             */
            status: "pending" | "delivered" | "failed" | "skipped";
            /** @description The HTTP status of the last attempt; null when it got no answer. */
            response_status: number | null;
            /** @description The start of the last answer, or the error. */
            response_snippet: string | null;
            next_attempt_at: string | null;
            delivered_at: string | null;
            /**
             * Format: date-time
             * @description When the event was queued for this endpoint.
             * @example 2026-11-10T17:52:00Z
             */
            created_at: string;
        };
        /** @description One page of webhookdelivery results. */
        WebhookDeliveryPage: {
            data: components["schemas"]["WebhookDelivery"][];
            /** @description Pass as `cursor` to get the next page; null on the last page. */
            next_cursor: string | null;
        };
        IntegrationList: {
            data: components["schemas"]["Integration"][];
        };
        Integration: {
            /**
             * @description ID of the integration (prefix `int_`).
             * @example int_01jd3x5k8qf7tb9w2m4n6p8r0s
             */
            id: string;
            kind: components["schemas"]["IntegrationKind"];
            active: boolean;
            /** @description The path to give the provider, under the app’s address. */
            webhook_path: string;
        };
        IntegrationCreated: {
            /**
             * @description ID of the integration (prefix `int_`).
             * @example int_01jd3x5k8qf7tb9w2m4n6p8r0s
             */
            id: string;
            kind: components["schemas"]["IntegrationKind"];
            active: boolean;
            /** @description The path to give the provider, under the app’s address. */
            webhook_path: string;
            /** @description For `generic`: the signing secret, shown only now. */
            secret: string | null;
        };
        /** @description One page of integrationevent results. */
        IntegrationEventPage: {
            data: components["schemas"]["IntegrationEvent"][];
            /** @description Pass as `cursor` to get the next page; null on the last page. */
            next_cursor: string | null;
        };
        IntegrationEvent: {
            /**
             * @description ID of the integration event (prefix `ine_`).
             * @example ine_01jd3x5k8qf7tb9w2m4n6p8r0s
             */
            id: string;
            integration_id: string | null;
            /** @description stripe, calcom, calendly, or what a generic sender says. */
            source: string;
            /** @description The provider’s event type, e.g. `checkout.session.completed`. */
            type: string;
            /** @description The provider’s ID; an event is stored once per source and ID. */
            external_id: string;
            contact_email: string | null;
            /** @description For generic events: the goal it reports. */
            goal_key: string | null;
            value_cents: number | null;
            outcome: components["schemas"]["IntegrationOutcome"] | null;
            matched_contact_id: string | null;
            matched_thread_id: string | null;
            /**
             * Format: date-time
             * @description When it arrived.
             * @example 2026-11-10T17:52:00Z
             */
            received_at: string;
            processed_at: string | null;
        };
        IntegrationEventReceived: {
            /**
             * @description ID of the integration event (prefix `ine_`).
             * @example ine_01jd3x5k8qf7tb9w2m4n6p8r0s
             */
            id: string;
            outcome: components["schemas"]["IntegrationOutcome"] | null;
            /** @description Seen before; nothing was done again. */
            duplicate: boolean;
        };
        DashboardOverview: {
            days: number;
            needs_you: {
                /** @description Open escalations. */
                open: number;
                /** @description Of them, urgent. */
                urgent: number;
                /** @description Emails waiting for approval. */
                pending_approval: number;
            };
            sent_today: {
                /** @description Sent today. */
                sent: number;
                /** @description Today’s capacity plan. */
                planned: number;
            };
            reply_rate: {
                /** @description Threads replied to of threads emailed, in the period, 0–1. */
                rate: number;
                /** @description The same, in the period before, 0–1. */
                previous: number;
                /** @description The change, in percentage points. */
                change_points: number;
                daily: {
                    /** Format: date */
                    day: string;
                    /** @description That day, 0–1. */
                    rate: number;
                }[];
            };
            goals: {
                reached: {
                    name: string;
                    /** @description Reached in the period. */
                    count: number;
                }[];
                /** @description Their estimated value. */
                value_cents: number;
            };
            campaigns: {
                /**
                 * @description ID of the campaign (prefix `cmp_`).
                 * @example cmp_01jd3x5k8qf7tb9w2m4n6p8r0s
                 */
                campaign_id: string;
                name: string;
                /**
                 * @description Its status.
                 * @enum {string}
                 */
                status: "active" | "paused";
                funnel: components["schemas"]["Funnel"];
            }[];
            deliverability: {
                /** @description Hard bounces of sends, 7 days, 0–1. */
                bounce_rate_7d: number;
                /** @description Complaints of sends, 7 days, 0–1. */
                complaint_rate_7d: number;
                /** @description Domains whose SPF, DKIM and DMARC pass. */
                domains_passing_dns: number;
                /** @description Domains on a blocklist. */
                domains_blocklisted: number;
                domains: {
                    /**
                     * @description ID of the domain (prefix `dom_`).
                     * @example dom_01jd3x5k8qf7tb9w2m4n6p8r0s
                     */
                    domain_id: string;
                    domain: string;
                    reputation_band: components["schemas"]["ReputationBand"];
                    ramp_step: number;
                    ramp_final_step: number;
                }[];
            };
            recent_activity: components["schemas"]["Activity"][];
        };
        /** @description Threads that reached each stage, then each goal (§15.4). */
        Funnel: {
            /** @description `sent`, `received`, `responded`, or `goal:<key>`. */
            key: string;
            name: string;
            /** @description Threads that reached it. */
            count: number;
            /** @description Of the stage before it, 0–1. */
            conversion: number;
        }[];
        FunnelResult: {
            campaign_id: string | null;
            since: string | null;
            stages: components["schemas"]["Funnel"];
        };
        CampaignStats: {
            /**
             * @description ID of the campaign (prefix `cmp_`).
             * @example cmp_01jd3x5k8qf7tb9w2m4n6p8r0s
             */
            campaign_id: string;
            since: string | null;
            funnel: components["schemas"]["Funnel"];
            threads: {
                /** @description Every thread. */
                total: number;
                /** @description Threads in each state. */
                by_state: {
                    [key: string]: number;
                };
            };
            emails: {
                /** @description Emails sent. */
                sent: number;
                /** @description Opened by a person. */
                opened: number;
                /** @description Bounced. */
                bounced: number;
                /** @description Threads with a human reply. */
                replies: number;
                /** @description Opened of sent, 0–1. */
                open_rate: number;
                /** @description Replies of sent, 0–1. */
                reply_rate: number;
                /** @description Bounced of sent, 0–1. */
                bounce_rate: number;
            };
            steps: {
                /**
                 * @description ID of the step (prefix `stp_`).
                 * @example stp_01jd3x5k8qf7tb9w2m4n6p8r0s
                 */
                step_id: string;
                /** @description "Initial email", or the sequence and step. */
                label: string;
                /** @description Sent. */
                sent: number;
                /** @description Opened by a person. */
                opened: number;
                /** @description Bounced. */
                bounced: number;
                /** @description First replies credited to it. */
                replies: number;
                /** @description Replies of sent, 0–1. */
                reply_rate: number;
                variants: {
                    /**
                     * @description ID of the variant (prefix `var_`).
                     * @example var_01jd3x5k8qf7tb9w2m4n6p8r0s
                     */
                    variant_id: string;
                    label: string;
                    /** @description Sent. */
                    sent: number;
                    /** @description Opened. */
                    opened: number;
                    /** @description Bounced. */
                    bounced: number;
                    /** @description Replies. */
                    replies: number;
                    /** @description Replies of sent, 0–1. */
                    reply_rate: number;
                }[];
            }[];
            goals: {
                /**
                 * @description ID of the goal (prefix `gol_`).
                 * @example gol_01jd3x5k8qf7tb9w2m4n6p8r0s
                 */
                goal_id: string;
                key: string;
                name: string;
                /** @description Threads that reached it. */
                achieved: number;
                /** @description Its value times the threads that reached it; null when it has no value. */
                value_cents: number | null;
            }[];
            /** @description The goals’ values added up. */
            value_cents: number;
        };
        KnowledgeGaps: {
            data: {
                /** @description How it was asked most recently. */
                question: string;
                /** @description Escalations it came up in. */
                asked: number;
                /** @description Of them, still open. */
                open: number;
                /** @description An answer was saved as knowledge for it. */
                answered: boolean;
                /** Format: date-time */
                last_asked_at: string;
                /** @description The latest escalations it came up in, newest first (at most 5). */
                escalation_ids: string[];
            }[];
        };
        /** @description One page of knowledgeitem results. */
        KnowledgeItemPage: {
            data: components["schemas"]["KnowledgeItem"][];
            /** @description Pass as `cursor` to get the next page; null on the last page. */
            next_cursor: string | null;
        };
        /** @description One fact the agent may use (§10). */
        KnowledgeItem: {
            /**
             * @description ID of the knowledge item (prefix `kbi_`).
             * @example kbi_01jd3x5k8qf7tb9w2m4n6p8r0s
             */
            id: string;
            campaign_id: string | null;
            kind: components["schemas"]["KnowledgeKind"];
            title: string;
            /** @description Markdown. */
            content: string;
            visibility: components["schemas"]["KnowledgeVisibility"];
            tags: string[];
            /**
             * @description Where it came from.
             * @enum {string}
             */
            source: "manual" | "escalation" | "import" | "api";
            source_escalation_id: string | null;
            /** @description Used by the agent. */
            active: boolean;
            /**
             * Format: date-time
             * @description When it was added.
             * @example 2026-11-10T17:52:00Z
             */
            created_at: string;
            /**
             * Format: date-time
             * @description When it last changed.
             * @example 2026-11-10T17:52:00Z
             */
            updated_at: string;
        };
        KnowledgeTest: {
            /** @description The knowledge answers it; false means the agent would escalate (`knowledge_gap`). */
            answerable: boolean;
            /** @description A sample answer, when it can give one. */
            answer: string | null;
            /** @description The items the answer rests on. */
            citations: {
                /**
                 * @description ID of the knowledge item (prefix `kbi_`).
                 * @example kbi_01jd3x5k8qf7tb9w2m4n6p8r0s
                 */
                id: string;
                title: string;
            }[];
        };
        WorkspaceSettings: {
            /**
             * @description ID of the workspace (prefix `wsp_`).
             * @example wsp_01jd3x5k8qf7tb9w2m4n6p8r0s
             */
            id: string;
            name: string;
            /** @description The postal address in the compliance footer (§8.8). */
            physical_address: string;
            /**
             * @description An IANA zone: the workspace day, and contacts with no zone of their own.
             * @example Europe/Berlin
             */
            default_timezone: string;
            business_hours: components["schemas"]["BusinessHoursOutput"];
            notifications: {
                /** @description A Slack incoming webhook gets alerts; the URL itself is never shown. */
                slack_configured: boolean;
                quiet_hours: components["schemas"]["QuietHoursOutput"] | null;
            };
            ai: components["schemas"]["AiSettings"];
            security: {
                /** @description Owners must sign in with two-factor authentication (§16). */
                require_owner_two_factor: boolean;
            };
            /**
             * Format: date-time
             * @description When the settings last changed.
             * @example 2026-11-10T17:52:00Z
             */
            updated_at: string;
        };
        AiSettings: {
            /**
             * @description The most AI may cost in a calendar month (workspace timezone), in USD; null for no cap. At 80% the owners and admins are told; at 100% the agent stops until the month turns, and replies go to a person (§10.2).
             * @example 200
             */
            monthly_budget_usd: number | null;
            /**
             * @description The month spend counts in, `YYYY-MM`.
             * @example 2026-11
             */
            month: string;
            /**
             * @description What AI has cost this month, in USD.
             * @example 61.25
             */
            spent_usd: number;
            /**
             * @description Spend over the budget (1 = all of it); null without a budget.
             * @example 0.3063
             */
            used: number | null;
            /**
             * @description Where spend stands against the budget.
             * @enum {string}
             */
            level: "unlimited" | "ok" | "warning" | "exhausted";
            /** @description Each Claude task’s model and effort (§10.2). */
            tasks: {
                task: components["schemas"]["ClaudeTask"];
                /**
                 * @description The model it runs on.
                 * @example claude-opus-5-5
                 */
                model: string;
                effort: components["schemas"]["Effort"];
                /** @description Set for this workspace, rather than the default. */
                overridden: boolean;
            }[];
            disclosure: components["schemas"]["AiDisclosure"];
            /** @description Jev, the classifier of record (§10.4). */
            jev: {
                /**
                 * @description The Jev version classifications run on; null while Jev isn’t set up (§10.4).
                 * @example jev-1.13.0
                 */
                model: string | null;
                pinned_by: ("workspace" | "deployment") | null;
                /**
                 * @description The classification thresholds in force (§10.4, §22.B), by name.
                 * @example {
                 *       "unsubscribeAct": 0.7,
                 *       "autoSendIntent": 0.7
                 *     }
                 */
                thresholds: {
                    [key: string]: number;
                };
                thresholds_updated_at: string | null;
            };
        };
        /** @description One page of user results. */
        UserPage: {
            data: components["schemas"]["User"][];
            /** @description Pass as `cursor` to get the next page; null on the last page. */
            next_cursor: string | null;
        };
        /** @description A person in the workspace. */
        User: {
            /**
             * @description ID of the user (prefix `usr_`).
             * @example usr_01jd3x5k8qf7tb9w2m4n6p8r0s
             */
            id: string;
            email: string;
            name: string;
            role: components["schemas"]["UserRole"];
            /** @description Their own IANA zone; null means the workspace’s. */
            timezone: string | null;
            notifications: {
                /** @description Alerts and the daily digest by email. */
                email: boolean;
                /** @description The daily digest. */
                digest: boolean;
            };
            last_login_at: string | null;
            deactivated_at: string | null;
            /**
             * Format: date-time
             * @description When they were added.
             * @example 2026-11-10T17:52:00Z
             */
            created_at: string;
        };
        ApiKeyList: {
            data: components["schemas"]["ApiKey"][];
        };
        /** @description An API key. The secret is shown once, when it is made; only its hash is kept. */
        ApiKey: {
            /**
             * @description ID of the API key (prefix `key_`).
             * @example key_01jd3x5k8qf7tb9w2m4n6p8r0s
             */
            id: string;
            /**
             * @description What it is for.
             * @example Claude Code (draft only)
             */
            name: string;
            /**
             * @description The first characters of the secret, to recognise it by.
             * @example ck_live_9F2a
             */
            prefix: string;
            /** @description What it may do (§13.2). */
            scopes: components["schemas"]["Scope"][];
            created_by: string | null;
            last_used_at: string | null;
            expires_at: string | null;
            revoked_at: string | null;
            /**
             * Format: date-time
             * @description When it was made.
             * @example 2026-11-10T17:52:00Z
             */
            created_at: string;
        };
        CreatedApiKey: {
            /**
             * @description ID of the API key (prefix `key_`).
             * @example key_01jd3x5k8qf7tb9w2m4n6p8r0s
             */
            id: string;
            /**
             * @description What it is for.
             * @example Claude Code (draft only)
             */
            name: string;
            /**
             * @description The first characters of the secret, to recognise it by.
             * @example ck_live_9F2a
             */
            prefix: string;
            /** @description What it may do (§13.2). */
            scopes: components["schemas"]["Scope"][];
            created_by: string | null;
            last_used_at: string | null;
            expires_at: string | null;
            revoked_at: string | null;
            /**
             * Format: date-time
             * @description When it was made.
             * @example 2026-11-10T17:52:00Z
             */
            created_at: string;
            /** @description The key itself, `ck_live_…`. Shown once: store it now. */
            secret: string;
        };
        AiUsage: {
            /**
             * Format: date-time
             * @description The start of the period.
             * @example 2026-11-10T17:52:00Z
             */
            since: string;
            total: {
                runs: number;
                /** @description USD. */
                cost_usd: number;
                input_tokens: number;
                output_tokens: number;
                cache_read_tokens: number;
                cache_write_tokens: number;
            };
            /** @description Days with runs, oldest first. */
            by_day: {
                /** @description `YYYY-MM-DD`. */
                day: string;
                runs: number;
                /** @description USD. */
                cost_usd: number;
            }[];
            by_task: {
                /**
                 * @description The Claude task (§10.1).
                 * @example draft_reply
                 */
                task: string;
                runs: number;
                /** @description USD. */
                cost_usd: number;
                /** @description Refused, errored or with output that failed validation. */
                failed: number;
                /** @description Drafts the §10.9 checks stopped. */
                guardrail_blocked: number;
                median_latency_ms: number | null;
            }[];
            by_model: {
                /** @description As the provider reported it. */
                model: string;
                runs: number;
                /** @description USD. */
                cost_usd: number;
            }[];
            /** @description Share of the replies read in the period that Claude classified alone, without a Jev answer (§10.4). */
            classification_fallback_rate: number;
            /** @description Of the replies both Jev and Claude read, the share where they disagreed (§10.4). */
            disagreement_rate: number;
            budget: {
                monthly_budget_usd: number | null;
                month: string;
                spent_usd: number;
                used: number | null;
                /**
                 * @description Where spend stands.
                 * @enum {string}
                 */
                level: "unlimited" | "ok" | "warning" | "exhausted";
            };
        };
        PushSettings: {
            /** @description Base64url, for `pushManager.subscribe`. */
            vapid_public_key: string | null;
            subscriptions: components["schemas"]["PushSubscription"][];
        };
        /** @description A browser that shows alerts. Its keys are never returned. */
        PushSubscription: {
            /**
             * @description ID of the push subscription (prefix `psb_`).
             * @example psb_01jd3x5k8qf7tb9w2m4n6p8r0s
             */
            id: string;
            /**
             * @description The browser’s push service, e.g. fcm.googleapis.com.
             * @example fcm.googleapis.com
             */
            endpoint_host: string;
            /** @description The browser that subscribed. */
            user_agent: string | null;
            /**
             * Format: date-time
             * @description When it subscribed.
             * @example 2026-11-10T17:52:00Z
             */
            created_at: string;
            last_sent_at: string | null;
        };
        /** @description When escalation SLAs run, in the workspace timezone (§11.1). */
        BusinessHoursOutput: {
            /** @description ISO weekdays: 1 = Monday … 7 = Sunday. */
            days: number[];
            /** @description `HH:MM`, 24-hour. */
            start: string;
            /** @description `HH:MM`, 24-hour. */
            end: string;
        };
        /** @description When high-priority mail waits until morning; urgent mail still goes (§11.2). May span midnight. */
        QuietHoursOutput: {
            /** @description `HH:MM`, 24-hour. */
            start: string;
            /** @description `HH:MM`, 24-hour. */
            end: string;
        };
    };
    responses: never;
    parameters: never;
    requestBodies: never;
    headers: never;
    pathItems: never;
}
export type $defs = Record<string, never>;
export interface operations {
    getOpenApiDocument: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The OpenAPI 3.1 document. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        [key: string]: unknown;
                    };
                };
            };
            /** @description Too many requests (`rate_limited`). `Retry-After` says when to try again. */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Server error (`internal_error`). */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    getCurrentPrincipal: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The current principal. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Principal"];
                };
            };
            /** @description No valid session or API key (`unauthorized`). */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests (`rate_limited`). `Retry-After` says when to try again. */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Server error (`internal_error`). */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    getWorkQueue: {
        parameters: {
            query?: {
                /** @description Most items to return, 1 to 200. */
                limit?: number;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The queue. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["WorkQueue"];
                };
            };
            /** @description The request is invalid (`validation_failed`). */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description No valid session or API key (`unauthorized`). */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description A required scope or role is missing (`forbidden_scope`). */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests (`rate_limited`). `Retry-After` says when to try again. */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Server error (`internal_error`). */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    streamEvents: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The event stream; it stays open. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "text/event-stream": string;
                };
            };
            /** @description No valid session or API key (`unauthorized`). */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests (`rate_limited`). `Retry-After` says when to try again. */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Server error (`internal_error`). */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    getJob: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description The task’s ID. */
                jobId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The task. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Job"];
                };
            };
            /** @description The request is invalid (`validation_failed`). */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description No valid session or API key (`unauthorized`). */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The resource does not exist in this workspace (`not_found`). */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests (`rate_limited`). `Retry-After` says when to try again. */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Server error (`internal_error`). */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    searchAll: {
        parameters: {
            query: {
                /** @description What to search for. */
                q: string;
                /** @description Most results to return, 1 to 50. */
                limit?: number;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The best matches. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SearchResults"];
                };
            };
            /** @description The request is invalid (`validation_failed`). */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description No valid session or API key (`unauthorized`). */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description A required scope or role is missing (`forbidden_scope`). */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests (`rate_limited`). `Retry-After` says when to try again. */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Server error (`internal_error`). */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    listContacts: {
        parameters: {
            query?: {
                /** @description Page size, 1 to 100. */
                limit?: number;
                /** @description The `next_cursor` of the previous page. Omit for the first page. */
                cursor?: string;
                /** @description Search text matched against name, email and title. */
                q?: string;
                /** @description Only contacts at this lifecycle stage. */
                lifecycle_stage?: components["schemas"]["LifecycleStage"];
                /** @description Only contacts with this verification result. */
                email_verification?: components["schemas"]["EmailVerification"];
                /** @description Only contacts with this subscription status. */
                subscription_status?: components["schemas"]["SubscriptionStatus"];
                /** @description Only contacts carrying this tag. */
                tag_id?: string;
                /** @description Only contacts at this company. */
                company_id?: string;
                /** @description Only contacts in this list, or matching this segment. */
                list_id?: string;
                /** @description Only contacts owned by this user. */
                owner_user_id?: string;
                /** @description Only contacts changed after this time. */
                updated_after?: string;
                /** @description URL-encoded JSON filter AST with AND/OR groups (§12.2). The same AST defines dynamic lists. */
                filter?: string;
                /** @description Sort order. A leading `-` means descending. Defaults to newest first. */
                sort?: "-created_at" | "created_at" | "-updated_at" | "-last_contacted_at" | "-last_replied_at" | "email";
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description A page of contacts. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ContactPage"];
                };
            };
            /** @description The request is invalid (`validation_failed`). */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description No valid session or API key (`unauthorized`). */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description A required scope or role is missing (`forbidden_scope`). */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests (`rate_limited`). `Retry-After` says when to try again. */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Server error (`internal_error`). */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    createContact: {
        parameters: {
            query?: never;
            header?: {
                /** @description A unique key for this request. Sending it again within 24 hours returns the stored response instead of acting twice. */
                "Idempotency-Key"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CreateContact"];
            };
        };
        responses: {
            /** @description The contact that was created. */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Contact"];
                };
            };
            /** @description The request is invalid (`validation_failed`). */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description No valid session or API key (`unauthorized`). */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description A required scope or role is missing (`forbidden_scope`). */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The request conflicts with the current state (`conflict`). */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The request cannot be carried out as sent (`idempotency_key_reused`, `send_blocked`). */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests (`rate_limited`). `Retry-After` says when to try again. */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Server error (`internal_error`). */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    getContact: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description The contact to act on. */
                contactId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The contact. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Contact"];
                };
            };
            /** @description The request is invalid (`validation_failed`). */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description No valid session or API key (`unauthorized`). */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description A required scope or role is missing (`forbidden_scope`). */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The resource does not exist in this workspace (`not_found`). */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests (`rate_limited`). `Retry-After` says when to try again. */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Server error (`internal_error`). */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    deleteContact: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description The contact to act on. */
                contactId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The contact was deleted. */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description The request is invalid (`validation_failed`). */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description No valid session or API key (`unauthorized`). */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description A required scope or role is missing (`forbidden_scope`). */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The resource does not exist in this workspace (`not_found`). */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests (`rate_limited`). `Retry-After` says when to try again. */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Server error (`internal_error`). */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    updateContact: {
        parameters: {
            query?: never;
            header?: {
                /** @description The `ETag` from your last GET of this resource. The change is refused if the resource has changed since. */
                "If-Match"?: string;
            };
            path: {
                /** @description The contact to act on. */
                contactId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["UpdateContact"];
            };
        };
        responses: {
            /** @description The contact after the change. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Contact"];
                };
            };
            /** @description The request is invalid (`validation_failed`). */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description No valid session or API key (`unauthorized`). */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description A required scope or role is missing (`forbidden_scope`). */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The resource does not exist in this workspace (`not_found`). */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The request conflicts with the current state (`conflict`). */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The `If-Match` ETag is stale (`precondition_failed`). */
            412: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests (`rate_limited`). `Retry-After` says when to try again. */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Server error (`internal_error`). */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    eraseContact: {
        parameters: {
            query?: never;
            header?: {
                /** @description A unique key for this request. Sending it again within 24 hours returns the stored response instead of acting twice. */
                "Idempotency-Key"?: string;
            };
            path: {
                /** @description The contact to act on. */
                contactId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The contact was erased. */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description The request is invalid (`validation_failed`). */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description No valid session or API key (`unauthorized`). */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description A required scope or role is missing (`forbidden_scope`). */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The resource does not exist in this workspace (`not_found`). */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The request cannot be carried out as sent (`idempotency_key_reused`, `send_blocked`). */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests (`rate_limited`). `Retry-After` says when to try again. */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Server error (`internal_error`). */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    upsertContacts: {
        parameters: {
            query?: never;
            header?: {
                /** @description A unique key for this request. Sending it again within 24 hours returns the stored response instead of acting twice. */
                "Idempotency-Key"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["UpsertContacts"];
            };
        };
        responses: {
            /** @description What happened to each row. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UpsertResult"];
                };
            };
            /** @description The request is invalid (`validation_failed`). */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description No valid session or API key (`unauthorized`). */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description A required scope or role is missing (`forbidden_scope`). */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The request cannot be carried out as sent (`idempotency_key_reused`, `send_blocked`). */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests (`rate_limited`). `Retry-After` says when to try again. */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Server error (`internal_error`). */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    applyContactBulkAction: {
        parameters: {
            query?: never;
            header?: {
                /** @description A unique key for this request. Sending it again within 24 hours returns the stored response instead of acting twice. */
                "Idempotency-Key"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ContactBulkActionRequest"];
            };
        };
        responses: {
            /** @description What the action did. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ContactBulkActionResult"];
                };
            };
            /** @description The request is invalid (`validation_failed`). */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description No valid session or API key (`unauthorized`). */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description A required scope or role is missing (`forbidden_scope`). */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The request cannot be carried out as sent (`idempotency_key_reused`, `send_blocked`). */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests (`rate_limited`). `Retry-After` says when to try again. */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Server error (`internal_error`). */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    mergeContacts: {
        parameters: {
            query?: never;
            header?: {
                /** @description A unique key for this request. Sending it again within 24 hours returns the stored response instead of acting twice. */
                "Idempotency-Key"?: string;
            };
            path: {
                /** @description The contact to act on. */
                contactId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["MergeContacts"];
            };
        };
        responses: {
            /** @description The contact after the merge. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Contact"];
                };
            };
            /** @description The request is invalid (`validation_failed`). */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description No valid session or API key (`unauthorized`). */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description A required scope or role is missing (`forbidden_scope`). */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The resource does not exist in this workspace (`not_found`). */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The request conflicts with the current state (`conflict`). */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The request cannot be carried out as sent (`idempotency_key_reused`, `send_blocked`). */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests (`rate_limited`). `Retry-After` says when to try again. */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Server error (`internal_error`). */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    listContactTimeline: {
        parameters: {
            query?: {
                /** @description Page size, 1 to 100. */
                limit?: number;
                /** @description The `next_cursor` of the previous page. Omit for the first page. */
                cursor?: string;
                /** @description Which kinds of entries to return. Defaults to all. */
                category?: "all" | "emails" | "status" | "notes" | "changes";
            };
            header?: never;
            path: {
                /** @description The contact to act on. */
                contactId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description A page of timeline entries. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ActivityPage"];
                };
            };
            /** @description The request is invalid (`validation_failed`). */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description No valid session or API key (`unauthorized`). */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description A required scope or role is missing (`forbidden_scope`). */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The resource does not exist in this workspace (`not_found`). */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests (`rate_limited`). `Retry-After` says when to try again. */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Server error (`internal_error`). */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    addContactNote: {
        parameters: {
            query?: never;
            header?: {
                /** @description A unique key for this request. Sending it again within 24 hours returns the stored response instead of acting twice. */
                "Idempotency-Key"?: string;
            };
            path: {
                /** @description The contact to act on. */
                contactId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ContactNote"];
            };
        };
        responses: {
            /** @description The timeline entry that was added. */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Activity"];
                };
            };
            /** @description The request is invalid (`validation_failed`). */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description No valid session or API key (`unauthorized`). */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description A required scope or role is missing (`forbidden_scope`). */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The resource does not exist in this workspace (`not_found`). */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The request cannot be carried out as sent (`idempotency_key_reused`, `send_blocked`). */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests (`rate_limited`). `Retry-After` says when to try again. */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Server error (`internal_error`). */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    verifyContactEmail: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description The contact to act on. */
                contactId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The contact with its new verification result. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["VerificationResult"];
                };
            };
            /** @description The request is invalid (`validation_failed`). */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description No valid session or API key (`unauthorized`). */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description A required scope or role is missing (`forbidden_scope`). */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The resource does not exist in this workspace (`not_found`). */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests (`rate_limited`). `Retry-After` says when to try again. */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Server error (`internal_error`). */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    exportContactData: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description The contact to act on. */
                contactId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The export. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ContactExport"];
                };
            };
            /** @description The request is invalid (`validation_failed`). */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description No valid session or API key (`unauthorized`). */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description A required scope or role is missing (`forbidden_scope`). */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The resource does not exist in this workspace (`not_found`). */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests (`rate_limited`). `Retry-After` says when to try again. */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Server error (`internal_error`). */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    listDuplicateContacts: {
        parameters: {
            query?: {
                /** @description Page size, 1 to 100. */
                limit?: number;
                /** @description The `next_cursor` of the previous page. Omit for the first page. */
                cursor?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description A page of duplicate groups. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DuplicateGroupPage"];
                };
            };
            /** @description The request is invalid (`validation_failed`). */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description No valid session or API key (`unauthorized`). */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description A required scope or role is missing (`forbidden_scope`). */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests (`rate_limited`). `Retry-After` says when to try again. */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Server error (`internal_error`). */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    createImport: {
        parameters: {
            query?: never;
            header?: {
                /** @description A unique key for this request. Sending it again within 24 hours returns the stored response instead of acting twice. */
                "Idempotency-Key"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CreateImport"];
            };
        };
        responses: {
            /** @description The stored file and a suggested mapping. */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Import"];
                };
            };
            /** @description The request is invalid (`validation_failed`). */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description No valid session or API key (`unauthorized`). */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description A required scope or role is missing (`forbidden_scope`). */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The request cannot be carried out as sent (`idempotency_key_reused`, `send_blocked`). */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests (`rate_limited`). `Retry-After` says when to try again. */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Server error (`internal_error`). */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    getImport: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description The import to act on. */
                importId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The import. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Import"];
                };
            };
            /** @description The request is invalid (`validation_failed`). */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description No valid session or API key (`unauthorized`). */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description A required scope or role is missing (`forbidden_scope`). */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The resource does not exist in this workspace (`not_found`). */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests (`rate_limited`). `Retry-After` says when to try again. */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Server error (`internal_error`). */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    previewImport: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description The import to act on. */
                importId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ImportOptions"];
            };
        };
        responses: {
            /** @description The dry-run counts. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ImportSummary"];
                };
            };
            /** @description The request is invalid (`validation_failed`). */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description No valid session or API key (`unauthorized`). */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description A required scope or role is missing (`forbidden_scope`). */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The resource does not exist in this workspace (`not_found`). */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests (`rate_limited`). `Retry-After` says when to try again. */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Server error (`internal_error`). */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    commitImport: {
        parameters: {
            query?: never;
            header?: {
                /** @description A unique key for this request. Sending it again within 24 hours returns the stored response instead of acting twice. */
                "Idempotency-Key"?: string;
            };
            path: {
                /** @description The import to act on. */
                importId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ImportOptions"];
            };
        };
        responses: {
            /** @description The import, now processing. */
            202: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Import"];
                };
            };
            /** @description The request is invalid (`validation_failed`). */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description No valid session or API key (`unauthorized`). */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description A required scope or role is missing (`forbidden_scope`). */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The resource does not exist in this workspace (`not_found`). */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The request conflicts with the current state (`conflict`). */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The request cannot be carried out as sent (`idempotency_key_reused`, `send_blocked`). */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests (`rate_limited`). `Retry-After` says when to try again. */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Server error (`internal_error`). */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    listCompanies: {
        parameters: {
            query?: {
                /** @description Page size, 1 to 100. */
                limit?: number;
                /** @description The `next_cursor` of the previous page. Omit for the first page. */
                cursor?: string;
                /** @description Search text matched against name and domain. */
                q?: string;
                /** @description Sort order. Defaults to name. */
                sort?: "name" | "-created_at";
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description A page of companies. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CompanyPage"];
                };
            };
            /** @description The request is invalid (`validation_failed`). */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description No valid session or API key (`unauthorized`). */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description A required scope or role is missing (`forbidden_scope`). */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests (`rate_limited`). `Retry-After` says when to try again. */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Server error (`internal_error`). */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    createCompany: {
        parameters: {
            query?: never;
            header?: {
                /** @description A unique key for this request. Sending it again within 24 hours returns the stored response instead of acting twice. */
                "Idempotency-Key"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CreateCompany"];
            };
        };
        responses: {
            /** @description The company that was created. */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Company"];
                };
            };
            /** @description The request is invalid (`validation_failed`). */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description No valid session or API key (`unauthorized`). */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description A required scope or role is missing (`forbidden_scope`). */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The request conflicts with the current state (`conflict`). */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The request cannot be carried out as sent (`idempotency_key_reused`, `send_blocked`). */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests (`rate_limited`). `Retry-After` says when to try again. */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Server error (`internal_error`). */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    getCompany: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description The company to act on. */
                companyId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The company. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Company"];
                };
            };
            /** @description The request is invalid (`validation_failed`). */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description No valid session or API key (`unauthorized`). */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description A required scope or role is missing (`forbidden_scope`). */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The resource does not exist in this workspace (`not_found`). */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests (`rate_limited`). `Retry-After` says when to try again. */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Server error (`internal_error`). */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    deleteCompany: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description The company to act on. */
                companyId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The company was deleted. */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description The request is invalid (`validation_failed`). */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description No valid session or API key (`unauthorized`). */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description A required scope or role is missing (`forbidden_scope`). */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The resource does not exist in this workspace (`not_found`). */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests (`rate_limited`). `Retry-After` says when to try again. */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Server error (`internal_error`). */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    updateCompany: {
        parameters: {
            query?: never;
            header?: {
                /** @description The `ETag` from your last GET of this resource. The change is refused if the resource has changed since. */
                "If-Match"?: string;
            };
            path: {
                /** @description The company to act on. */
                companyId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["UpdateCompany"];
            };
        };
        responses: {
            /** @description The company after the change. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Company"];
                };
            };
            /** @description The request is invalid (`validation_failed`). */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description No valid session or API key (`unauthorized`). */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description A required scope or role is missing (`forbidden_scope`). */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The resource does not exist in this workspace (`not_found`). */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The request conflicts with the current state (`conflict`). */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The `If-Match` ETag is stale (`precondition_failed`). */
            412: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests (`rate_limited`). `Retry-After` says when to try again. */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Server error (`internal_error`). */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    listTags: {
        parameters: {
            query?: {
                /** @description Page size, 1 to 100. */
                limit?: number;
                /** @description The `next_cursor` of the previous page. Omit for the first page. */
                cursor?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description A page of tags. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["TagPage"];
                };
            };
            /** @description The request is invalid (`validation_failed`). */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description No valid session or API key (`unauthorized`). */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description A required scope or role is missing (`forbidden_scope`). */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests (`rate_limited`). `Retry-After` says when to try again. */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Server error (`internal_error`). */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    createTag: {
        parameters: {
            query?: never;
            header?: {
                /** @description A unique key for this request. Sending it again within 24 hours returns the stored response instead of acting twice. */
                "Idempotency-Key"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CreateTag"];
            };
        };
        responses: {
            /** @description The tag that was created. */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Tag"];
                };
            };
            /** @description The request is invalid (`validation_failed`). */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description No valid session or API key (`unauthorized`). */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description A required scope or role is missing (`forbidden_scope`). */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The request conflicts with the current state (`conflict`). */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The request cannot be carried out as sent (`idempotency_key_reused`, `send_blocked`). */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests (`rate_limited`). `Retry-After` says when to try again. */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Server error (`internal_error`). */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    deleteTag: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description The tag to delete. */
                tagId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The tag was deleted. */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description The request is invalid (`validation_failed`). */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description No valid session or API key (`unauthorized`). */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description A required scope or role is missing (`forbidden_scope`). */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The resource does not exist in this workspace (`not_found`). */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests (`rate_limited`). `Retry-After` says when to try again. */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Server error (`internal_error`). */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    listLists: {
        parameters: {
            query?: {
                /** @description Page size, 1 to 100. */
                limit?: number;
                /** @description The `next_cursor` of the previous page. Omit for the first page. */
                cursor?: string;
                /** @description Only lists of this kind. */
                kind?: components["schemas"]["ListKind"];
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description A page of lists. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ListPage"];
                };
            };
            /** @description The request is invalid (`validation_failed`). */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description No valid session or API key (`unauthorized`). */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description A required scope or role is missing (`forbidden_scope`). */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests (`rate_limited`). `Retry-After` says when to try again. */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Server error (`internal_error`). */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    createList: {
        parameters: {
            query?: never;
            header?: {
                /** @description A unique key for this request. Sending it again within 24 hours returns the stored response instead of acting twice. */
                "Idempotency-Key"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CreateList"];
            };
        };
        responses: {
            /** @description The list that was created. */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["List"];
                };
            };
            /** @description The request is invalid (`validation_failed`). */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description No valid session or API key (`unauthorized`). */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description A required scope or role is missing (`forbidden_scope`). */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The request cannot be carried out as sent (`idempotency_key_reused`, `send_blocked`). */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests (`rate_limited`). `Retry-After` says when to try again. */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Server error (`internal_error`). */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    getList: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description The list to act on. */
                listId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The list. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["List"];
                };
            };
            /** @description The request is invalid (`validation_failed`). */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description No valid session or API key (`unauthorized`). */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description A required scope or role is missing (`forbidden_scope`). */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The resource does not exist in this workspace (`not_found`). */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests (`rate_limited`). `Retry-After` says when to try again. */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Server error (`internal_error`). */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    deleteList: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description The list to act on. */
                listId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The list was deleted. */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description The request is invalid (`validation_failed`). */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description No valid session or API key (`unauthorized`). */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description A required scope or role is missing (`forbidden_scope`). */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The resource does not exist in this workspace (`not_found`). */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests (`rate_limited`). `Retry-After` says when to try again. */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Server error (`internal_error`). */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    updateList: {
        parameters: {
            query?: never;
            header?: {
                /** @description The `ETag` from your last GET of this resource. The change is refused if the resource has changed since. */
                "If-Match"?: string;
            };
            path: {
                /** @description The list to act on. */
                listId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["UpdateList"];
            };
        };
        responses: {
            /** @description The list after the change. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["List"];
                };
            };
            /** @description The request is invalid (`validation_failed`). */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description No valid session or API key (`unauthorized`). */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description A required scope or role is missing (`forbidden_scope`). */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The resource does not exist in this workspace (`not_found`). */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The request conflicts with the current state (`conflict`). */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The `If-Match` ETag is stale (`precondition_failed`). */
            412: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests (`rate_limited`). `Retry-After` says when to try again. */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Server error (`internal_error`). */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    listListMembers: {
        parameters: {
            query?: {
                /** @description Page size, 1 to 100. */
                limit?: number;
                /** @description The `next_cursor` of the previous page. Omit for the first page. */
                cursor?: string;
            };
            header?: never;
            path: {
                /** @description The list to act on. */
                listId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description A page of contacts. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ContactPage"];
                };
            };
            /** @description The request is invalid (`validation_failed`). */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description No valid session or API key (`unauthorized`). */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description A required scope or role is missing (`forbidden_scope`). */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The resource does not exist in this workspace (`not_found`). */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests (`rate_limited`). `Retry-After` says when to try again. */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Server error (`internal_error`). */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    addListMembers: {
        parameters: {
            query?: never;
            header?: {
                /** @description A unique key for this request. Sending it again within 24 hours returns the stored response instead of acting twice. */
                "Idempotency-Key"?: string;
            };
            path: {
                /** @description The list to act on. */
                listId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ListMembers"];
            };
        };
        responses: {
            /** @description How many were added. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ListMembersAdded"];
                };
            };
            /** @description The request is invalid (`validation_failed`). */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description No valid session or API key (`unauthorized`). */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description A required scope or role is missing (`forbidden_scope`). */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The resource does not exist in this workspace (`not_found`). */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The request conflicts with the current state (`conflict`). */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The request cannot be carried out as sent (`idempotency_key_reused`, `send_blocked`). */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests (`rate_limited`). `Retry-After` says when to try again. */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Server error (`internal_error`). */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    removeListMembers: {
        parameters: {
            query: {
                /** @description Comma-separated contact IDs to remove, at most 100. */
                contact_ids: string;
            };
            header?: never;
            path: {
                /** @description The list to act on. */
                listId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description How many were removed. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ListMembersRemoved"];
                };
            };
            /** @description The request is invalid (`validation_failed`). */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description No valid session or API key (`unauthorized`). */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description A required scope or role is missing (`forbidden_scope`). */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The resource does not exist in this workspace (`not_found`). */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The request conflicts with the current state (`conflict`). */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests (`rate_limited`). `Retry-After` says when to try again. */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Server error (`internal_error`). */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    previewSegment: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["PreviewSegment"];
            };
        };
        responses: {
            /** @description The count and a sample. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SegmentPreview"];
                };
            };
            /** @description The request is invalid (`validation_failed`). */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description No valid session or API key (`unauthorized`). */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description A required scope or role is missing (`forbidden_scope`). */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests (`rate_limited`). `Retry-After` says when to try again. */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Server error (`internal_error`). */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    listCustomFields: {
        parameters: {
            query?: {
                /** @description Page size, 1 to 100. */
                limit?: number;
                /** @description The `next_cursor` of the previous page. Omit for the first page. */
                cursor?: string;
                /** @description Only fields of this entity. */
                entity?: components["schemas"]["CustomFieldEntity"];
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description A page of custom fields. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CustomFieldPage"];
                };
            };
            /** @description The request is invalid (`validation_failed`). */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description No valid session or API key (`unauthorized`). */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description A required scope or role is missing (`forbidden_scope`). */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests (`rate_limited`). `Retry-After` says when to try again. */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Server error (`internal_error`). */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    createCustomField: {
        parameters: {
            query?: never;
            header?: {
                /** @description A unique key for this request. Sending it again within 24 hours returns the stored response instead of acting twice. */
                "Idempotency-Key"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CreateCustomField"];
            };
        };
        responses: {
            /** @description The field that was defined. */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CustomField"];
                };
            };
            /** @description The request is invalid (`validation_failed`). */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description No valid session or API key (`unauthorized`). */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description A required scope or role is missing (`forbidden_scope`). */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The request conflicts with the current state (`conflict`). */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The request cannot be carried out as sent (`idempotency_key_reused`, `send_blocked`). */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests (`rate_limited`). `Retry-After` says when to try again. */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Server error (`internal_error`). */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    deleteCustomField: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description The custom field to act on. */
                fieldId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The field was deleted. */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description The request is invalid (`validation_failed`). */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description No valid session or API key (`unauthorized`). */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description A required scope or role is missing (`forbidden_scope`). */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The resource does not exist in this workspace (`not_found`). */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests (`rate_limited`). `Retry-After` says when to try again. */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Server error (`internal_error`). */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    updateCustomField: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description The custom field to act on. */
                fieldId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["UpdateCustomField"];
            };
        };
        responses: {
            /** @description The field after the change. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CustomField"];
                };
            };
            /** @description The request is invalid (`validation_failed`). */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description No valid session or API key (`unauthorized`). */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description A required scope or role is missing (`forbidden_scope`). */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The resource does not exist in this workspace (`not_found`). */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests (`rate_limited`). `Retry-After` says when to try again. */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Server error (`internal_error`). */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    listSuppressions: {
        parameters: {
            query?: {
                /** @description Page size, 1 to 100. */
                limit?: number;
                /** @description The `next_cursor` of the previous page. Omit for the first page. */
                cursor?: string;
                /** @description Only suppressions with this reason. */
                reason?: components["schemas"]["SuppressionReason"];
                /** @description Text matched against the address or domain. */
                q?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description A page of suppressions. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SuppressionPage"];
                };
            };
            /** @description The request is invalid (`validation_failed`). */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description No valid session or API key (`unauthorized`). */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description A required scope or role is missing (`forbidden_scope`). */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests (`rate_limited`). `Retry-After` says when to try again. */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Server error (`internal_error`). */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    createSuppression: {
        parameters: {
            query?: never;
            header?: {
                /** @description A unique key for this request. Sending it again within 24 hours returns the stored response instead of acting twice. */
                "Idempotency-Key"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CreateSuppression"];
            };
        };
        responses: {
            /** @description The suppression that was added. */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Suppression"];
                };
            };
            /** @description The request is invalid (`validation_failed`). */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description No valid session or API key (`unauthorized`). */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description A required scope or role is missing (`forbidden_scope`). */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The request conflicts with the current state (`conflict`). */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The request cannot be carried out as sent (`idempotency_key_reused`, `send_blocked`). */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests (`rate_limited`). `Retry-After` says when to try again. */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Server error (`internal_error`). */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    deleteSuppression: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description The suppression to remove. */
                suppressionId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The suppression was removed. */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description The request is invalid (`validation_failed`). */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description No valid session or API key (`unauthorized`). */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description A required scope or role is missing (`forbidden_scope`). */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The resource does not exist in this workspace (`not_found`). */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests (`rate_limited`). `Retry-After` says when to try again. */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Server error (`internal_error`). */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    checkSuppression: {
        parameters: {
            query: {
                /** @description The address to check. */
                email: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Whether the address is blocked. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SuppressionCheck"];
                };
            };
            /** @description The request is invalid (`validation_failed`). */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description No valid session or API key (`unauthorized`). */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description A required scope or role is missing (`forbidden_scope`). */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests (`rate_limited`). `Retry-After` says when to try again. */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Server error (`internal_error`). */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    listCampaigns: {
        parameters: {
            query?: {
                /** @description Page size, 1 to 100. */
                limit?: number;
                /** @description The `next_cursor` of the previous page. Omit for the first page. */
                cursor?: string;
                /** @description Only campaigns with this status. */
                status?: components["schemas"]["CampaignStatus"];
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description A page of campaigns. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CampaignPage"];
                };
            };
            /** @description The request is invalid (`validation_failed`). */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description No valid session or API key (`unauthorized`). */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description A required scope or role is missing (`forbidden_scope`). */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests (`rate_limited`). `Retry-After` says when to try again. */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Server error (`internal_error`). */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    createCampaign: {
        parameters: {
            query?: never;
            header?: {
                /** @description A unique key for this request. Sending it again within 24 hours returns the stored response instead of acting twice. */
                "Idempotency-Key"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CreateCampaign"];
            };
        };
        responses: {
            /** @description The draft campaign. */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Campaign"];
                };
            };
            /** @description The request is invalid (`validation_failed`). */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description No valid session or API key (`unauthorized`). */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description A required scope or role is missing (`forbidden_scope`). */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The request cannot be carried out as sent (`idempotency_key_reused`, `send_blocked`). */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests (`rate_limited`). `Retry-After` says when to try again. */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Server error (`internal_error`). */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    getCampaign: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description The campaign. */
                campaignId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The campaign. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Campaign"];
                };
            };
            /** @description The request is invalid (`validation_failed`). */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description No valid session or API key (`unauthorized`). */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description A required scope or role is missing (`forbidden_scope`). */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The resource does not exist in this workspace (`not_found`). */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests (`rate_limited`). `Retry-After` says when to try again. */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Server error (`internal_error`). */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    deleteCampaign: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description The campaign. */
                campaignId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The campaign was deleted. */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description The request is invalid (`validation_failed`). */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description No valid session or API key (`unauthorized`). */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description A required scope or role is missing (`forbidden_scope`). */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The resource does not exist in this workspace (`not_found`). */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The request conflicts with the current state (`conflict`). */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests (`rate_limited`). `Retry-After` says when to try again. */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Server error (`internal_error`). */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    updateCampaign: {
        parameters: {
            query?: never;
            header?: {
                /** @description The `ETag` from your last GET of this resource. The change is refused if the resource has changed since. */
                "If-Match"?: string;
            };
            path: {
                /** @description The campaign. */
                campaignId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["UpdateCampaign"];
            };
        };
        responses: {
            /** @description The campaign after the change. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Campaign"];
                };
            };
            /** @description The request is invalid (`validation_failed`). */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description No valid session or API key (`unauthorized`). */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description A required scope or role is missing (`forbidden_scope`). */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The resource does not exist in this workspace (`not_found`). */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The request conflicts with the current state (`conflict`). */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The `If-Match` ETag is stale (`precondition_failed`). */
            412: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests (`rate_limited`). `Retry-After` says when to try again. */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Server error (`internal_error`). */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    archiveCampaign: {
        parameters: {
            query?: never;
            header?: {
                /** @description A unique key for this request. Sending it again within 24 hours returns the stored response instead of acting twice. */
                "Idempotency-Key"?: string;
            };
            path: {
                /** @description The campaign. */
                campaignId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The campaign. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Campaign"];
                };
            };
            /** @description The request is invalid (`validation_failed`). */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description No valid session or API key (`unauthorized`). */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description A required scope or role is missing (`forbidden_scope`). */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The resource does not exist in this workspace (`not_found`). */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The request conflicts with the current state (`conflict`). */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The request cannot be carried out as sent (`idempotency_key_reused`, `send_blocked`). */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests (`rate_limited`). `Retry-After` says when to try again. */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Server error (`internal_error`). */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    runCampaignPreflight: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description The campaign. */
                campaignId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The checklist. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Preflight"];
                };
            };
            /** @description The request is invalid (`validation_failed`). */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description No valid session or API key (`unauthorized`). */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description A required scope or role is missing (`forbidden_scope`). */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The resource does not exist in this workspace (`not_found`). */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests (`rate_limited`). `Retry-After` says when to try again. */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Server error (`internal_error`). */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    launchCampaign: {
        parameters: {
            query?: never;
            header?: {
                /** @description A unique key for this request. Sending it again within 24 hours returns the stored response instead of acting twice. */
                "Idempotency-Key"?: string;
            };
            path: {
                /** @description The campaign. */
                campaignId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The campaign. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Campaign"];
                };
            };
            /** @description The request is invalid (`validation_failed`). */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description No valid session or API key (`unauthorized`). */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description A required scope or role is missing (`forbidden_scope`). */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The resource does not exist in this workspace (`not_found`). */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The request conflicts with the current state (`conflict`). */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The request cannot be carried out as sent (`idempotency_key_reused`, `send_blocked`). */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests (`rate_limited`). `Retry-After` says when to try again. */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Server error (`internal_error`). */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    pauseCampaign: {
        parameters: {
            query?: never;
            header?: {
                /** @description A unique key for this request. Sending it again within 24 hours returns the stored response instead of acting twice. */
                "Idempotency-Key"?: string;
            };
            path: {
                /** @description The campaign. */
                campaignId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The campaign. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Campaign"];
                };
            };
            /** @description The request is invalid (`validation_failed`). */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description No valid session or API key (`unauthorized`). */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description A required scope or role is missing (`forbidden_scope`). */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The resource does not exist in this workspace (`not_found`). */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The request conflicts with the current state (`conflict`). */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The request cannot be carried out as sent (`idempotency_key_reused`, `send_blocked`). */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests (`rate_limited`). `Retry-After` says when to try again. */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Server error (`internal_error`). */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    resumeCampaign: {
        parameters: {
            query?: never;
            header?: {
                /** @description A unique key for this request. Sending it again within 24 hours returns the stored response instead of acting twice. */
                "Idempotency-Key"?: string;
            };
            path: {
                /** @description The campaign. */
                campaignId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The campaign. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Campaign"];
                };
            };
            /** @description The request is invalid (`validation_failed`). */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description No valid session or API key (`unauthorized`). */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description A required scope or role is missing (`forbidden_scope`). */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The resource does not exist in this workspace (`not_found`). */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The request conflicts with the current state (`conflict`). */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The request cannot be carried out as sent (`idempotency_key_reused`, `send_blocked`). */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests (`rate_limited`). `Retry-After` says when to try again. */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Server error (`internal_error`). */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    listCampaignGoals: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description The campaign. */
                campaignId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The goals. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GoalList"];
                };
            };
            /** @description The request is invalid (`validation_failed`). */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description No valid session or API key (`unauthorized`). */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description A required scope or role is missing (`forbidden_scope`). */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The resource does not exist in this workspace (`not_found`). */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests (`rate_limited`). `Retry-After` says when to try again. */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Server error (`internal_error`). */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    createCampaignGoal: {
        parameters: {
            query?: never;
            header?: {
                /** @description A unique key for this request. Sending it again within 24 hours returns the stored response instead of acting twice. */
                "Idempotency-Key"?: string;
            };
            path: {
                /** @description The campaign. */
                campaignId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CreateGoal"];
            };
        };
        responses: {
            /** @description The goal. */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Goal"];
                };
            };
            /** @description The request is invalid (`validation_failed`). */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description No valid session or API key (`unauthorized`). */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description A required scope or role is missing (`forbidden_scope`). */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The resource does not exist in this workspace (`not_found`). */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The request conflicts with the current state (`conflict`). */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The request cannot be carried out as sent (`idempotency_key_reused`, `send_blocked`). */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests (`rate_limited`). `Retry-After` says when to try again. */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Server error (`internal_error`). */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    deleteCampaignGoal: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description The campaign. */
                campaignId: string;
                /** @description The goal. */
                goalId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The goal was deleted. */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description The request is invalid (`validation_failed`). */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description No valid session or API key (`unauthorized`). */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description A required scope or role is missing (`forbidden_scope`). */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The resource does not exist in this workspace (`not_found`). */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The request conflicts with the current state (`conflict`). */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests (`rate_limited`). `Retry-After` says when to try again. */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Server error (`internal_error`). */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    updateCampaignGoal: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description The campaign. */
                campaignId: string;
                /** @description The goal. */
                goalId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["UpdateGoal"];
            };
        };
        responses: {
            /** @description The goal. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Goal"];
                };
            };
            /** @description The request is invalid (`validation_failed`). */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description No valid session or API key (`unauthorized`). */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description A required scope or role is missing (`forbidden_scope`). */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The resource does not exist in this workspace (`not_found`). */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The request conflicts with the current state (`conflict`). */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests (`rate_limited`). `Retry-After` says when to try again. */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Server error (`internal_error`). */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    reorderCampaignGoals: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description The campaign. */
                campaignId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ReorderGoals"];
            };
        };
        responses: {
            /** @description The goals in their new order. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GoalList"];
                };
            };
            /** @description The request is invalid (`validation_failed`). */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description No valid session or API key (`unauthorized`). */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description A required scope or role is missing (`forbidden_scope`). */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The resource does not exist in this workspace (`not_found`). */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The request conflicts with the current state (`conflict`). */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests (`rate_limited`). `Retry-After` says when to try again. */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Server error (`internal_error`). */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    getInitialEmail: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description The campaign. */
                campaignId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The initial email. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Step"];
                };
            };
            /** @description The request is invalid (`validation_failed`). */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description No valid session or API key (`unauthorized`). */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description A required scope or role is missing (`forbidden_scope`). */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The resource does not exist in this workspace (`not_found`). */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests (`rate_limited`). `Retry-After` says when to try again. */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Server error (`internal_error`). */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    updateInitialEmail: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description The campaign. */
                campaignId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["UpdateInitialEmail"];
            };
        };
        responses: {
            /** @description The initial email. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Step"];
                };
            };
            /** @description The request is invalid (`validation_failed`). */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description No valid session or API key (`unauthorized`). */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description A required scope or role is missing (`forbidden_scope`). */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The resource does not exist in this workspace (`not_found`). */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The request conflicts with the current state (`conflict`). */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests (`rate_limited`). `Retry-After` says when to try again. */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Server error (`internal_error`). */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    listFollowUpSequences: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description The campaign. */
                campaignId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The sequences and the stage map. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["FollowUpSequenceList"];
                };
            };
            /** @description The request is invalid (`validation_failed`). */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description No valid session or API key (`unauthorized`). */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description A required scope or role is missing (`forbidden_scope`). */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The resource does not exist in this workspace (`not_found`). */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests (`rate_limited`). `Retry-After` says when to try again. */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Server error (`internal_error`). */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    createFollowUpSequence: {
        parameters: {
            query?: never;
            header?: {
                /** @description A unique key for this request. Sending it again within 24 hours returns the stored response instead of acting twice. */
                "Idempotency-Key"?: string;
            };
            path: {
                /** @description The campaign. */
                campaignId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CreateFollowUpSequence"];
            };
        };
        responses: {
            /** @description The sequence. */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["FollowUpSequence"];
                };
            };
            /** @description The request is invalid (`validation_failed`). */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description No valid session or API key (`unauthorized`). */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description A required scope or role is missing (`forbidden_scope`). */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The resource does not exist in this workspace (`not_found`). */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The request conflicts with the current state (`conflict`). */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The request cannot be carried out as sent (`idempotency_key_reused`, `send_blocked`). */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests (`rate_limited`). `Retry-After` says when to try again. */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Server error (`internal_error`). */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    getFollowUpSequence: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description The campaign. */
                campaignId: string;
                /** @description The follow-up sequence. */
                sequenceId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The sequence. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["FollowUpSequence"];
                };
            };
            /** @description The request is invalid (`validation_failed`). */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description No valid session or API key (`unauthorized`). */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description A required scope or role is missing (`forbidden_scope`). */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The resource does not exist in this workspace (`not_found`). */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests (`rate_limited`). `Retry-After` says when to try again. */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Server error (`internal_error`). */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    deleteFollowUpSequence: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description The campaign. */
                campaignId: string;
                /** @description The follow-up sequence. */
                sequenceId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The sequence was deleted. */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description The request is invalid (`validation_failed`). */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description No valid session or API key (`unauthorized`). */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description A required scope or role is missing (`forbidden_scope`). */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The resource does not exist in this workspace (`not_found`). */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The request conflicts with the current state (`conflict`). */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests (`rate_limited`). `Retry-After` says when to try again. */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Server error (`internal_error`). */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    updateFollowUpSequence: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description The campaign. */
                campaignId: string;
                /** @description The follow-up sequence. */
                sequenceId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["UpdateFollowUpSequence"];
            };
        };
        responses: {
            /** @description The sequence. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["FollowUpSequence"];
                };
            };
            /** @description The request is invalid (`validation_failed`). */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description No valid session or API key (`unauthorized`). */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description A required scope or role is missing (`forbidden_scope`). */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The resource does not exist in this workspace (`not_found`). */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The request conflicts with the current state (`conflict`). */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests (`rate_limited`). `Retry-After` says when to try again. */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Server error (`internal_error`). */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    createFollowUpStep: {
        parameters: {
            query?: never;
            header?: {
                /** @description A unique key for this request. Sending it again within 24 hours returns the stored response instead of acting twice. */
                "Idempotency-Key"?: string;
            };
            path: {
                /** @description The campaign. */
                campaignId: string;
                /** @description The follow-up sequence. */
                sequenceId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["StepInput"];
            };
        };
        responses: {
            /** @description The step. */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Step"];
                };
            };
            /** @description The request is invalid (`validation_failed`). */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description No valid session or API key (`unauthorized`). */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description A required scope or role is missing (`forbidden_scope`). */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The resource does not exist in this workspace (`not_found`). */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The request conflicts with the current state (`conflict`). */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The request cannot be carried out as sent (`idempotency_key_reused`, `send_blocked`). */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests (`rate_limited`). `Retry-After` says when to try again. */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Server error (`internal_error`). */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    deleteFollowUpStep: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description The campaign. */
                campaignId: string;
                /** @description The follow-up sequence. */
                sequenceId: string;
                /** @description The step. */
                stepId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The step was deleted. */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description The request is invalid (`validation_failed`). */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description No valid session or API key (`unauthorized`). */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description A required scope or role is missing (`forbidden_scope`). */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The resource does not exist in this workspace (`not_found`). */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The request conflicts with the current state (`conflict`). */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests (`rate_limited`). `Retry-After` says when to try again. */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Server error (`internal_error`). */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    updateFollowUpStep: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description The campaign. */
                campaignId: string;
                /** @description The follow-up sequence. */
                sequenceId: string;
                /** @description The step. */
                stepId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["UpdateFollowUpStep"];
            };
        };
        responses: {
            /** @description The step. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Step"];
                };
            };
            /** @description The request is invalid (`validation_failed`). */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description No valid session or API key (`unauthorized`). */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description A required scope or role is missing (`forbidden_scope`). */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The resource does not exist in this workspace (`not_found`). */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests (`rate_limited`). `Retry-After` says when to try again. */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Server error (`internal_error`). */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    reorderFollowUpSteps: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description The campaign. */
                campaignId: string;
                /** @description The follow-up sequence. */
                sequenceId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ReorderSteps"];
            };
        };
        responses: {
            /** @description The sequence. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["FollowUpSequence"];
                };
            };
            /** @description The request is invalid (`validation_failed`). */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description No valid session or API key (`unauthorized`). */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description A required scope or role is missing (`forbidden_scope`). */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The resource does not exist in this workspace (`not_found`). */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests (`rate_limited`). `Retry-After` says when to try again. */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Server error (`internal_error`). */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    createStepVariant: {
        parameters: {
            query?: never;
            header?: {
                /** @description A unique key for this request. Sending it again within 24 hours returns the stored response instead of acting twice. */
                "Idempotency-Key"?: string;
            };
            path: {
                /** @description The campaign. */
                campaignId: string;
                /** @description The initial email or a follow-up step. */
                stepId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["VariantInput"];
            };
        };
        responses: {
            /** @description The variant. */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Variant"];
                };
            };
            /** @description The request is invalid (`validation_failed`). */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description No valid session or API key (`unauthorized`). */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description A required scope or role is missing (`forbidden_scope`). */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The resource does not exist in this workspace (`not_found`). */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The request cannot be carried out as sent (`idempotency_key_reused`, `send_blocked`). */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests (`rate_limited`). `Retry-After` says when to try again. */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Server error (`internal_error`). */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    deleteStepVariant: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description The campaign. */
                campaignId: string;
                /** @description The step. */
                stepId: string;
                /** @description The variant. */
                variantId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The variant was deleted. */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description The request is invalid (`validation_failed`). */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description No valid session or API key (`unauthorized`). */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description A required scope or role is missing (`forbidden_scope`). */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The resource does not exist in this workspace (`not_found`). */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The request conflicts with the current state (`conflict`). */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests (`rate_limited`). `Retry-After` says when to try again. */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Server error (`internal_error`). */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    updateStepVariant: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description The campaign. */
                campaignId: string;
                /** @description The step. */
                stepId: string;
                /** @description The variant. */
                variantId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["UpdateVariant"];
            };
        };
        responses: {
            /** @description The variant. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Variant"];
                };
            };
            /** @description The request is invalid (`validation_failed`). */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description No valid session or API key (`unauthorized`). */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description A required scope or role is missing (`forbidden_scope`). */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The resource does not exist in this workspace (`not_found`). */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests (`rate_limited`). `Retry-After` says when to try again. */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Server error (`internal_error`). */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    previewCampaignStep: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description The campaign. */
                campaignId: string;
                /** @description The initial email or a follow-up step. */
                stepId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["PreviewStep"];
            };
        };
        responses: {
            /** @description The rendered email. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["StepPreview"];
                };
            };
            /** @description The request is invalid (`validation_failed`). */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description No valid session or API key (`unauthorized`). */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description A required scope or role is missing (`forbidden_scope`). */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The resource does not exist in this workspace (`not_found`). */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests (`rate_limited`). `Retry-After` says when to try again. */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Server error (`internal_error`). */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    setCampaignMailboxes: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description The campaign. */
                campaignId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CampaignMailboxes"];
            };
        };
        responses: {
            /** @description The campaign. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Campaign"];
                };
            };
            /** @description The request is invalid (`validation_failed`). */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description No valid session or API key (`unauthorized`). */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description A required scope or role is missing (`forbidden_scope`). */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The resource does not exist in this workspace (`not_found`). */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The request conflicts with the current state (`conflict`). */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests (`rate_limited`). `Retry-After` says when to try again. */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Server error (`internal_error`). */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    enrollContacts: {
        parameters: {
            query?: never;
            header?: {
                /** @description A unique key for this request. Sending it again within 24 hours returns the stored response instead of acting twice. */
                "Idempotency-Key"?: string;
            };
            path: {
                /** @description The campaign. */
                campaignId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["EnrollContacts"];
            };
        };
        responses: {
            /** @description Who was enrolled and who was skipped. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EnrollmentResult"];
                };
            };
            /** @description The request is invalid (`validation_failed`). */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description No valid session or API key (`unauthorized`). */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description A required scope or role is missing (`forbidden_scope`). */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The resource does not exist in this workspace (`not_found`). */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The request conflicts with the current state (`conflict`). */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The request cannot be carried out as sent (`idempotency_key_reused`, `send_blocked`). */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests (`rate_limited`). `Retry-After` says when to try again. */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Server error (`internal_error`). */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    listThreads: {
        parameters: {
            query?: {
                /** @description Page size, 1 to 100. */
                limit?: number;
                /** @description The `next_cursor` of the previous page. Omit for the first page. */
                cursor?: string;
                /** @description Only threads in this campaign. */
                campaign_id?: string;
                /** @description Only threads with this contact. */
                contact_id?: string;
                /** @description Only threads on this mailbox. */
                mailbox_id?: string;
                /** @description Only threads at this stage. */
                stage?: components["schemas"]["ThreadStage"];
                /** @description Only threads at this stage rank or later (3 = Responded). */
                min_stage_rank?: number;
                /** @description Only threads that reached this goal. */
                goal_id?: string;
                /** @description Only threads in this state. */
                state?: components["schemas"]["ThreadState"];
                /** @description Only threads with this open status. */
                open_status?: components["schemas"]["OpenStatus"];
                /** @description Only threads whose latest intent is this, e.g. question. */
                intent?: string;
                /** @description Only threads at least this hot: 2 = evaluating (the Hot view). */
                min_temperature?: number;
                /** @description Only threads assigned to this user. */
                assigned_to?: string;
                /** @description true: only threads waiting on a person (needs_human or pending_approval). */
                needs_attention?: "true" | "false";
                /** @description Text matched against the contact’s name and email and the subject. */
                q?: string;
                /** @description Only threads changed after this time. */
                updated_after?: string;
                /** @description Sort order. Defaults to most recent email first. */
                sort?: "-last_message_at" | "-temperature" | "-updated_at" | "-created_at";
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description A page of threads. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ThreadPage"];
                };
            };
            /** @description The request is invalid (`validation_failed`). */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description No valid session or API key (`unauthorized`). */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description A required scope or role is missing (`forbidden_scope`). */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests (`rate_limited`). `Retry-After` says when to try again. */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Server error (`internal_error`). */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    getThread: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description The thread. */
                threadId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The thread. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Thread"];
                };
            };
            /** @description The request is invalid (`validation_failed`). */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description No valid session or API key (`unauthorized`). */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description A required scope or role is missing (`forbidden_scope`). */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The resource does not exist in this workspace (`not_found`). */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests (`rate_limited`). `Retry-After` says when to try again. */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Server error (`internal_error`). */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    updateThread: {
        parameters: {
            query?: never;
            header?: {
                /** @description The `ETag` from your last GET of this resource. The change is refused if the resource has changed since. */
                "If-Match"?: string;
            };
            path: {
                /** @description The thread. */
                threadId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["UpdateThread"];
            };
        };
        responses: {
            /** @description The thread. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Thread"];
                };
            };
            /** @description The request is invalid (`validation_failed`). */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description No valid session or API key (`unauthorized`). */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description A required scope or role is missing (`forbidden_scope`). */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The resource does not exist in this workspace (`not_found`). */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The `If-Match` ETag is stale (`precondition_failed`). */
            412: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests (`rate_limited`). `Retry-After` says when to try again. */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Server error (`internal_error`). */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    getThreadContext: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description The thread. */
                threadId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The bundle. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ThreadContext"];
                };
            };
            /** @description The request is invalid (`validation_failed`). */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description No valid session or API key (`unauthorized`). */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description A required scope or role is missing (`forbidden_scope`). */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The resource does not exist in this workspace (`not_found`). */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests (`rate_limited`). `Retry-After` says when to try again. */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Server error (`internal_error`). */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    listThreadMessages: {
        parameters: {
            query?: {
                /** @description Page size, 1 to 100. */
                limit?: number;
                /** @description The `next_cursor` of the previous page. Omit for the first page. */
                cursor?: string;
            };
            header?: never;
            path: {
                /** @description The thread. */
                threadId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description A page of messages. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MessagePage"];
                };
            };
            /** @description The request is invalid (`validation_failed`). */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description No valid session or API key (`unauthorized`). */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description A required scope or role is missing (`forbidden_scope`). */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The resource does not exist in this workspace (`not_found`). */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests (`rate_limited`). `Retry-After` says when to try again. */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Server error (`internal_error`). */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    listThreadActivity: {
        parameters: {
            query?: {
                /** @description Page size, 1 to 100. */
                limit?: number;
                /** @description The `next_cursor` of the previous page. Omit for the first page. */
                cursor?: string;
            };
            header?: never;
            path: {
                /** @description The thread. */
                threadId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description A page of activity. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ActivityPage"];
                };
            };
            /** @description The request is invalid (`validation_failed`). */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description No valid session or API key (`unauthorized`). */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description A required scope or role is missing (`forbidden_scope`). */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The resource does not exist in this workspace (`not_found`). */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests (`rate_limited`). `Retry-After` says when to try again. */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Server error (`internal_error`). */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    listThreadClassifications: {
        parameters: {
            query?: {
                /** @description Page size, 1 to 100. */
                limit?: number;
                /** @description The `next_cursor` of the previous page. Omit for the first page. */
                cursor?: string;
            };
            header?: never;
            path: {
                /** @description The thread. */
                threadId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description A page of classifications. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ClassificationPage"];
                };
            };
            /** @description The request is invalid (`validation_failed`). */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description No valid session or API key (`unauthorized`). */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description A required scope or role is missing (`forbidden_scope`). */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The resource does not exist in this workspace (`not_found`). */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests (`rate_limited`). `Retry-After` says when to try again. */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Server error (`internal_error`). */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    reclassifyThread: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description The thread. */
                threadId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The new classification. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Classification"];
                };
            };
            /** @description The request is invalid (`validation_failed`). */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description No valid session or API key (`unauthorized`). */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description A required scope or role is missing (`forbidden_scope`). */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The resource does not exist in this workspace (`not_found`). */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The request conflicts with the current state (`conflict`). */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests (`rate_limited`). `Retry-After` says when to try again. */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Server error (`internal_error`). */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The AI agent is off, failed or is over budget (`ai_unavailable`, `budget_exceeded`). */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    markGoalAchieved: {
        parameters: {
            query?: never;
            header?: {
                /** @description A unique key for this request. Sending it again within 24 hours returns the stored response instead of acting twice. */
                "Idempotency-Key"?: string;
            };
            path: {
                /** @description The thread. */
                threadId: string;
                /** @description The goal. */
                goalId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["MarkGoalAchieved"];
            };
        };
        responses: {
            /** @description The thread. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Thread"];
                };
            };
            /** @description The request is invalid (`validation_failed`). */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description No valid session or API key (`unauthorized`). */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description A required scope or role is missing (`forbidden_scope`). */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The resource does not exist in this workspace (`not_found`). */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The request conflicts with the current state (`conflict`). */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The request cannot be carried out as sent (`idempotency_key_reused`, `send_blocked`). */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests (`rate_limited`). `Retry-After` says when to try again. */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Server error (`internal_error`). */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    revokeGoalAchievement: {
        parameters: {
            query: {
                /** @description Why it was wrong. */
                reason: string;
            };
            header?: never;
            path: {
                /** @description The thread. */
                threadId: string;
                /** @description The goal. */
                goalId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The thread. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Thread"];
                };
            };
            /** @description The request is invalid (`validation_failed`). */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description No valid session or API key (`unauthorized`). */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description A required scope or role is missing (`forbidden_scope`). */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The resource does not exist in this workspace (`not_found`). */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The request conflicts with the current state (`conflict`). */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests (`rate_limited`). `Retry-After` says when to try again. */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Server error (`internal_error`). */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    setThreadStageFloor: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description The thread. */
                threadId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["SetStageFloor"];
            };
        };
        responses: {
            /** @description The thread. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Thread"];
                };
            };
            /** @description The request is invalid (`validation_failed`). */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description No valid session or API key (`unauthorized`). */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description A required scope or role is missing (`forbidden_scope`). */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The resource does not exist in this workspace (`not_found`). */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The request conflicts with the current state (`conflict`). */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests (`rate_limited`). `Retry-After` says when to try again. */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Server error (`internal_error`). */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    pauseThread: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description The thread. */
                threadId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The thread. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Thread"];
                };
            };
            /** @description The request is invalid (`validation_failed`). */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description No valid session or API key (`unauthorized`). */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description A required scope or role is missing (`forbidden_scope`). */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The resource does not exist in this workspace (`not_found`). */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The request conflicts with the current state (`conflict`). */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests (`rate_limited`). `Retry-After` says when to try again. */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Server error (`internal_error`). */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    resumeThread: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description The thread. */
                threadId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The thread. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Thread"];
                };
            };
            /** @description The request is invalid (`validation_failed`). */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description No valid session or API key (`unauthorized`). */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description A required scope or role is missing (`forbidden_scope`). */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The resource does not exist in this workspace (`not_found`). */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The request conflicts with the current state (`conflict`). */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests (`rate_limited`). `Retry-After` says when to try again. */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Server error (`internal_error`). */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    closeThread: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description The thread. */
                threadId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CloseThread"];
            };
        };
        responses: {
            /** @description The thread. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Thread"];
                };
            };
            /** @description The request is invalid (`validation_failed`). */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description No valid session or API key (`unauthorized`). */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description A required scope or role is missing (`forbidden_scope`). */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The resource does not exist in this workspace (`not_found`). */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The request conflicts with the current state (`conflict`). */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests (`rate_limited`). `Retry-After` says when to try again. */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Server error (`internal_error`). */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    stopFollowUps: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description The thread. */
                threadId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The thread. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Thread"];
                };
            };
            /** @description The request is invalid (`validation_failed`). */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description No valid session or API key (`unauthorized`). */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description A required scope or role is missing (`forbidden_scope`). */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The resource does not exist in this workspace (`not_found`). */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The request conflicts with the current state (`conflict`). */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests (`rate_limited`). `Retry-After` says when to try again. */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Server error (`internal_error`). */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    resumeFollowUps: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description The thread. */
                threadId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The thread. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Thread"];
                };
            };
            /** @description The request is invalid (`validation_failed`). */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description No valid session or API key (`unauthorized`). */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description A required scope or role is missing (`forbidden_scope`). */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The resource does not exist in this workspace (`not_found`). */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The request conflicts with the current state (`conflict`). */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests (`rate_limited`). `Retry-After` says when to try again. */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Server error (`internal_error`). */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    skipNextAction: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description The thread. */
                threadId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The thread. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Thread"];
                };
            };
            /** @description The request is invalid (`validation_failed`). */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description No valid session or API key (`unauthorized`). */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description A required scope or role is missing (`forbidden_scope`). */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The resource does not exist in this workspace (`not_found`). */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The request conflicts with the current state (`conflict`). */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests (`rate_limited`). `Retry-After` says when to try again. */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Server error (`internal_error`). */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    scheduleCheckIn: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description The thread. */
                threadId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /**
                     * Format: date
                     * @description The day to check in, `YYYY-MM-DD` in the contact’s timezone: after today, and at most a year ahead.
                     * @example 2027-03-02
                     */
                    date: string;
                };
            };
        };
        responses: {
            /** @description The thread. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Thread"];
                };
            };
            /** @description The request is invalid (`validation_failed`). */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description No valid session or API key (`unauthorized`). */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description A required scope or role is missing (`forbidden_scope`). */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The resource does not exist in this workspace (`not_found`). */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The request conflicts with the current state (`conflict`). */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests (`rate_limited`). `Retry-After` says when to try again. */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Server error (`internal_error`). */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    cancelCheckIn: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description The thread. */
                threadId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The thread. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Thread"];
                };
            };
            /** @description The request is invalid (`validation_failed`). */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description No valid session or API key (`unauthorized`). */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description A required scope or role is missing (`forbidden_scope`). */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The resource does not exist in this workspace (`not_found`). */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The request conflicts with the current state (`conflict`). */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests (`rate_limited`). `Retry-After` says when to try again. */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Server error (`internal_error`). */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    rescheduleNextAction: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description The thread. */
                threadId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["RescheduleNextAction"];
            };
        };
        responses: {
            /** @description The thread. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Thread"];
                };
            };
            /** @description The request is invalid (`validation_failed`). */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description No valid session or API key (`unauthorized`). */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description A required scope or role is missing (`forbidden_scope`). */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The resource does not exist in this workspace (`not_found`). */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The request conflicts with the current state (`conflict`). */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests (`rate_limited`). `Retry-After` says when to try again. */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Server error (`internal_error`). */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    sendNextActionNow: {
        parameters: {
            query?: never;
            header: {
                /** @description A unique key for this request. Sending it again within 24 hours returns the stored response instead of acting twice. */
                "Idempotency-Key": string;
            };
            path: {
                /** @description The thread. */
                threadId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The thread. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Thread"];
                };
            };
            /** @description The request is invalid (`validation_failed`). */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description No valid session or API key (`unauthorized`). */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description A required scope or role is missing (`forbidden_scope`). */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The resource does not exist in this workspace (`not_found`). */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The request conflicts with the current state (`conflict`). */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The request cannot be carried out as sent (`idempotency_key_reused`, `send_blocked`). */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests (`rate_limited`). `Retry-After` says when to try again. */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Server error (`internal_error`). */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    createReply: {
        parameters: {
            query?: never;
            header?: {
                /** @description A unique key for this request. Sending it again within 24 hours returns the stored response instead of acting twice. */
                "Idempotency-Key"?: string;
            };
            path: {
                /** @description The thread. */
                threadId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /** @description The plain-text body. Catalyst adds the signature and, where the campaign uses one, the compliance footer, and renders the HTML part. */
                    body_text: string;
                    /**
                     * @description What to do with it.
                     * @enum {string}
                     */
                    mode: "draft" | "send_now" | "schedule";
                    /**
                     * Format: date-time
                     * @description Required when `mode` is `schedule`.
                     * @example 2026-11-12T15:30:00Z
                     */
                    send_at?: string;
                };
            };
        };
        responses: {
            /** @description The reply. */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Message"];
                };
            };
            /** @description The request is invalid (`validation_failed`). */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description No valid session or API key (`unauthorized`). */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description A required scope or role is missing (`forbidden_scope`). */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The resource does not exist in this workspace (`not_found`). */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The request conflicts with the current state (`conflict`). */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The request cannot be carried out as sent (`idempotency_key_reused`, `send_blocked`). */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests (`rate_limited`). `Retry-After` says when to try again. */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Server error (`internal_error`). */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    generateAiDraft: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description The thread. */
                threadId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /** @description What the reply should do, e.g. "offer Thursday or Friday". */
                    guidance?: string;
                };
            };
        };
        responses: {
            /** @description The draft. */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Message"];
                };
            };
            /** @description The request is invalid (`validation_failed`). */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description No valid session or API key (`unauthorized`). */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description A required scope or role is missing (`forbidden_scope`). */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The resource does not exist in this workspace (`not_found`). */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The request conflicts with the current state (`conflict`). */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests (`rate_limited`). `Retry-After` says when to try again. */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Server error (`internal_error`). */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The AI agent is off, failed or is over budget (`ai_unavailable`, `budget_exceeded`). */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    getMessage: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description The email. */
                messageId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The message. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Message"];
                };
            };
            /** @description The request is invalid (`validation_failed`). */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description No valid session or API key (`unauthorized`). */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description A required scope or role is missing (`forbidden_scope`). */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The resource does not exist in this workspace (`not_found`). */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests (`rate_limited`). `Retry-After` says when to try again. */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Server error (`internal_error`). */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    updateDraft: {
        parameters: {
            query?: never;
            header?: {
                /** @description The `ETag` from your last GET of this resource. The change is refused if the resource has changed since. */
                "If-Match"?: string;
            };
            path: {
                /** @description The email. */
                messageId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /** @description The whole new body, including signature and footer. */
                    body_text?: string;
                    /** @description A new subject. Replies keep "Re: " and the thread’s subject. */
                    subject?: string;
                };
            };
        };
        responses: {
            /** @description The email. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Message"];
                };
            };
            /** @description The request is invalid (`validation_failed`). */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description No valid session or API key (`unauthorized`). */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description A required scope or role is missing (`forbidden_scope`). */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The resource does not exist in this workspace (`not_found`). */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The request conflicts with the current state (`conflict`). */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The `If-Match` ETag is stale (`precondition_failed`). */
            412: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests (`rate_limited`). `Retry-After` says when to try again. */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Server error (`internal_error`). */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    getMessageRaw: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description The email. */
                messageId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The raw email. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "message/rfc822": string;
                };
            };
            /** @description The request is invalid (`validation_failed`). */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description No valid session or API key (`unauthorized`). */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description A required scope or role is missing (`forbidden_scope`). */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The resource does not exist in this workspace (`not_found`). */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests (`rate_limited`). `Retry-After` says when to try again. */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Server error (`internal_error`). */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    listPendingDrafts: {
        parameters: {
            query?: {
                /** @description Page size, 1 to 100. */
                limit?: number;
                /** @description The `next_cursor` of the previous page. Omit for the first page. */
                cursor?: string;
                /** @description Only drafts in this campaign. */
                campaign_id?: string;
                /** @description Only drafts on this thread. */
                thread_id?: string;
                /** @description Only this status. */
                status?: "draft" | "pending_approval";
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description A page of drafts. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MessagePage"];
                };
            };
            /** @description The request is invalid (`validation_failed`). */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description No valid session or API key (`unauthorized`). */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description A required scope or role is missing (`forbidden_scope`). */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests (`rate_limited`). `Retry-After` says when to try again. */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Server error (`internal_error`). */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    approveDraft: {
        parameters: {
            query?: never;
            header: {
                /** @description A unique key for this request. Sending it again within 24 hours returns the stored response instead of acting twice. */
                "Idempotency-Key": string;
            };
            path: {
                /** @description The email. */
                messageId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /**
                     * Format: date-time
                     * @description When to send it. Moved into the campaign’s sending window in the contact’s timezone if it falls outside.
                     * @example 2026-11-12T15:30:00Z
                     */
                    send_at?: string;
                };
            };
        };
        responses: {
            /** @description The scheduled email. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Message"];
                };
            };
            /** @description The request is invalid (`validation_failed`). */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description No valid session or API key (`unauthorized`). */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description A required scope or role is missing (`forbidden_scope`). */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The resource does not exist in this workspace (`not_found`). */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The request conflicts with the current state (`conflict`). */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The request cannot be carried out as sent (`idempotency_key_reused`, `send_blocked`). */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests (`rate_limited`). `Retry-After` says when to try again. */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Server error (`internal_error`). */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    rejectDraft: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description The email. */
                messageId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /** @description Why, in words. */
                    reason: string;
                    /** @description What a redraft should do differently. */
                    feedback?: string;
                };
            };
        };
        responses: {
            /** @description The cancelled email. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Message"];
                };
            };
            /** @description The request is invalid (`validation_failed`). */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description No valid session or API key (`unauthorized`). */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description A required scope or role is missing (`forbidden_scope`). */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The resource does not exist in this workspace (`not_found`). */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The request conflicts with the current state (`conflict`). */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests (`rate_limited`). `Retry-After` says when to try again. */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Server error (`internal_error`). */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    cancelScheduledMessage: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description The email. */
                messageId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The cancelled email. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Message"];
                };
            };
            /** @description The request is invalid (`validation_failed`). */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description No valid session or API key (`unauthorized`). */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description A required scope or role is missing (`forbidden_scope`). */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The resource does not exist in this workspace (`not_found`). */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The request conflicts with the current state (`conflict`). */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests (`rate_limited`). `Retry-After` says when to try again. */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Server error (`internal_error`). */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    lintMessage: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /** @description The subject. */
                    subject: string;
                    /** @description The whole plain-text body. */
                    body_text: string;
                    /**
                     * @description Lint it as a first email to the contact, which is held to stricter rules.
                     * @default false
                     */
                    first_touch?: boolean;
                    /**
                     * @description Require an unsubscribe link and the physical address.
                     * @default false
                     */
                    compliance_required?: boolean;
                };
            };
        };
        responses: {
            /** @description The findings. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["LintResult"];
                };
            };
            /** @description The request is invalid (`validation_failed`). */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description No valid session or API key (`unauthorized`). */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description A required scope or role is missing (`forbidden_scope`). */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests (`rate_limited`). `Retry-After` says when to try again. */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Server error (`internal_error`). */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    listUnmatchedMessages: {
        parameters: {
            query?: {
                /** @description Page size, 1 to 100. */
                limit?: number;
                /** @description The `next_cursor` of the previous page. Omit for the first page. */
                cursor?: string;
                /** @description Only mail that arrived in this mailbox. */
                mailbox_id?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description A page of emails. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MessagePage"];
                };
            };
            /** @description The request is invalid (`validation_failed`). */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description No valid session or API key (`unauthorized`). */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description A required scope or role is missing (`forbidden_scope`). */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests (`rate_limited`). `Retry-After` says when to try again. */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Server error (`internal_error`). */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    attachMessageToThread: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description The email. */
                messageId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /**
                     * @description The thread it belongs to.
                     * @example thr_01jd3x5k8qf7tb9w2m4n6p8r0s
                     */
                    thread_id: string;
                };
            };
        };
        responses: {
            /** @description The email, now in the thread. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Message"];
                };
            };
            /** @description The request is invalid (`validation_failed`). */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description No valid session or API key (`unauthorized`). */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description A required scope or role is missing (`forbidden_scope`). */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The resource does not exist in this workspace (`not_found`). */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The request conflicts with the current state (`conflict`). */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests (`rate_limited`). `Retry-After` says when to try again. */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Server error (`internal_error`). */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    ignoreUnmatchedMessage: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description The email. */
                messageId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The email. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Message"];
                };
            };
            /** @description The request is invalid (`validation_failed`). */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description No valid session or API key (`unauthorized`). */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description A required scope or role is missing (`forbidden_scope`). */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The resource does not exist in this workspace (`not_found`). */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The request conflicts with the current state (`conflict`). */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests (`rate_limited`). `Retry-After` says when to try again. */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Server error (`internal_error`). */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    listActivities: {
        parameters: {
            query?: {
                /** @description Page size, 1 to 100. */
                limit?: number;
                /** @description The `next_cursor` of the previous page. Omit for the first page. */
                cursor?: string;
                /** @description Only this thread’s activity. */
                thread_id?: string;
                /** @description Only this contact’s activity. */
                contact_id?: string;
                /** @description Only this campaign’s activity. */
                campaign_id?: string;
                /** @description A type, or a prefix ending in a dot: `domain.` for every domain event. */
                type?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description A page of activity. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ActivityPage"];
                };
            };
            /** @description The request is invalid (`validation_failed`). */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description No valid session or API key (`unauthorized`). */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description A required scope or role is missing (`forbidden_scope`). */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests (`rate_limited`). `Retry-After` says when to try again. */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Server error (`internal_error`). */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    listEscalations: {
        parameters: {
            query?: {
                /** @description Page size, 1 to 100. */
                limit?: number;
                /** @description The `next_cursor` of the previous page. Omit for the first page. */
                cursor?: string;
                /** @description Which status. */
                status?: "open" | "snoozed" | "resolved" | "dismissed" | "all";
                /** @description Only this priority. */
                priority?: components["schemas"]["EscalationPriority"];
                /** @description Only this reason. */
                reason?: components["schemas"]["EscalationReason"];
                /** @description Only escalations on this thread. */
                thread_id?: string;
                /** @description Only escalations in this campaign. */
                campaign_id?: string;
                /** @description Only those assigned to this person. */
                assigned_user_id?: string;
                /** @description true: only those past their SLA; false: only those within it. */
                overdue?: "true" | "false";
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description A page of escalations. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EscalationPage"];
                };
            };
            /** @description The request is invalid (`validation_failed`). */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description No valid session or API key (`unauthorized`). */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description A required scope or role is missing (`forbidden_scope`). */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests (`rate_limited`). `Retry-After` says when to try again. */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Server error (`internal_error`). */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    getEscalation: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description The escalation. */
                escalationId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The escalation. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Escalation"];
                };
            };
            /** @description The request is invalid (`validation_failed`). */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description No valid session or API key (`unauthorized`). */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description A required scope or role is missing (`forbidden_scope`). */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The resource does not exist in this workspace (`not_found`). */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests (`rate_limited`). `Retry-After` says when to try again. */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Server error (`internal_error`). */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    resolveEscalation: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description The escalation. */
                escalationId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /**
                     * @description How it was settled.
                     * @enum {string}
                     */
                    resolution: "replied" | "answered_for_ai" | "goal_confirmed" | "goal_rejected" | "took_over" | "closed_thread";
                    /** @description A note for the record. */
                    note?: string;
                };
            };
        };
        responses: {
            /** @description The escalation. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Escalation"];
                };
            };
            /** @description The request is invalid (`validation_failed`). */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description No valid session or API key (`unauthorized`). */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description A required scope or role is missing (`forbidden_scope`). */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The resource does not exist in this workspace (`not_found`). */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The request conflicts with the current state (`conflict`). */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests (`rate_limited`). `Retry-After` says when to try again. */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Server error (`internal_error`). */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    snoozeEscalation: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description The escalation. */
                escalationId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /**
                     * Format: date-time
                     * @description When it comes back.
                     * @example 2026-11-12T09:00:00Z
                     */
                    until: string;
                    /** @description A note for the record. */
                    note?: string;
                };
            };
        };
        responses: {
            /** @description The escalation. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Escalation"];
                };
            };
            /** @description The request is invalid (`validation_failed`). */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description No valid session or API key (`unauthorized`). */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description A required scope or role is missing (`forbidden_scope`). */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The resource does not exist in this workspace (`not_found`). */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The request conflicts with the current state (`conflict`). */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests (`rate_limited`). `Retry-After` says when to try again. */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Server error (`internal_error`). */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    assignEscalation: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description The escalation. */
                escalationId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    user_id: string | null;
                };
            };
        };
        responses: {
            /** @description The escalation. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Escalation"];
                };
            };
            /** @description The request is invalid (`validation_failed`). */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description No valid session or API key (`unauthorized`). */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description A required scope or role is missing (`forbidden_scope`). */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The resource does not exist in this workspace (`not_found`). */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The request conflicts with the current state (`conflict`). */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests (`rate_limited`). `Retry-After` says when to try again. */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Server error (`internal_error`). */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    dismissEscalation: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description The escalation. */
                escalationId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /** @description Why no action is needed. */
                    reason: string;
                };
            };
        };
        responses: {
            /** @description The escalation. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Escalation"];
                };
            };
            /** @description The request is invalid (`validation_failed`). */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description No valid session or API key (`unauthorized`). */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description A required scope or role is missing (`forbidden_scope`). */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The resource does not exist in this workspace (`not_found`). */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The request conflicts with the current state (`conflict`). */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests (`rate_limited`). `Retry-After` says when to try again. */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Server error (`internal_error`). */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    answerEscalation: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description The escalation. */
                escalationId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /** @description The answer, in plain language. */
                    answer: string;
                    /**
                     * @description Keep it as a knowledge item.
                     * @default true
                     */
                    save_to_knowledge?: boolean;
                    /**
                     * @description Where the knowledge item applies.
                     * @default campaign
                     * @enum {string}
                     */
                    knowledge_scope?: "campaign" | "workspace";
                };
            };
        };
        responses: {
            /** @description The resolved escalation and the new draft. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EscalationAnswered"];
                };
            };
            /** @description The request is invalid (`validation_failed`). */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description No valid session or API key (`unauthorized`). */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description A required scope or role is missing (`forbidden_scope`). */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The resource does not exist in this workspace (`not_found`). */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The request conflicts with the current state (`conflict`). */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests (`rate_limited`). `Retry-After` says when to try again. */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Server error (`internal_error`). */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The AI agent is off, failed or is over budget (`ai_unavailable`, `budget_exceeded`). */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    listMailboxes: {
        parameters: {
            query?: {
                /** @description Page size, 1 to 100. */
                limit?: number;
                /** @description The `next_cursor` of the previous page. Omit for the first page. */
                cursor?: string;
                /** @description Only mailboxes on this domain. */
                domain_id?: string;
                /** @description Only mailboxes with this status. */
                status?: components["schemas"]["MailboxStatus"];
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description A page of mailboxes. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MailboxPage"];
                };
            };
            /** @description The request is invalid (`validation_failed`). */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description No valid session or API key (`unauthorized`). */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description A required scope or role is missing (`forbidden_scope`). */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests (`rate_limited`). `Retry-After` says when to try again. */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Server error (`internal_error`). */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    createMailbox: {
        parameters: {
            query?: never;
            header?: {
                /** @description A unique key for this request. Sending it again within 24 hours returns the stored response instead of acting twice. */
                "Idempotency-Key"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CreateMailbox"];
            };
        };
        responses: {
            /** @description The mailbox that was added. */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Mailbox"];
                };
            };
            /** @description The request is invalid (`validation_failed`). */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description No valid session or API key (`unauthorized`). */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description A required scope or role is missing (`forbidden_scope`). */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The request conflicts with the current state (`conflict`). */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The request cannot be carried out as sent (`idempotency_key_reused`, `send_blocked`). */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests (`rate_limited`). `Retry-After` says when to try again. */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Server error (`internal_error`). */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    getMailbox: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description The mailbox. */
                mailboxId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The mailbox. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Mailbox"];
                };
            };
            /** @description The request is invalid (`validation_failed`). */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description No valid session or API key (`unauthorized`). */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description A required scope or role is missing (`forbidden_scope`). */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The resource does not exist in this workspace (`not_found`). */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests (`rate_limited`). `Retry-After` says when to try again. */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Server error (`internal_error`). */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    deleteMailbox: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description The mailbox. */
                mailboxId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The mailbox was removed. */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description The request is invalid (`validation_failed`). */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description No valid session or API key (`unauthorized`). */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description A required scope or role is missing (`forbidden_scope`). */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The resource does not exist in this workspace (`not_found`). */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The request conflicts with the current state (`conflict`). */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests (`rate_limited`). `Retry-After` says when to try again. */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Server error (`internal_error`). */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    updateMailbox: {
        parameters: {
            query?: never;
            header?: {
                /** @description The `ETag` from your last GET of this resource. The change is refused if the resource has changed since. */
                "If-Match"?: string;
            };
            path: {
                /** @description The mailbox. */
                mailboxId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["UpdateMailbox"];
            };
        };
        responses: {
            /** @description The mailbox after the change. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Mailbox"];
                };
            };
            /** @description The request is invalid (`validation_failed`). */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description No valid session or API key (`unauthorized`). */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description A required scope or role is missing (`forbidden_scope`). */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The resource does not exist in this workspace (`not_found`). */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The `If-Match` ETag is stale (`precondition_failed`). */
            412: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests (`rate_limited`). `Retry-After` says when to try again. */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Server error (`internal_error`). */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    pauseMailbox: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description The mailbox. */
                mailboxId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["PauseMailbox"];
            };
        };
        responses: {
            /** @description The paused mailbox. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Mailbox"];
                };
            };
            /** @description The request is invalid (`validation_failed`). */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description No valid session or API key (`unauthorized`). */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description A required scope or role is missing (`forbidden_scope`). */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The resource does not exist in this workspace (`not_found`). */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The request conflicts with the current state (`conflict`). */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests (`rate_limited`). `Retry-After` says when to try again. */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Server error (`internal_error`). */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    resumeMailbox: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description The mailbox. */
                mailboxId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ResumeMailbox"];
            };
        };
        responses: {
            /** @description The mailbox, sending again. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Mailbox"];
                };
            };
            /** @description The request is invalid (`validation_failed`). */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description No valid session or API key (`unauthorized`). */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description A required scope or role is missing (`forbidden_scope`). */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The resource does not exist in this workspace (`not_found`). */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The request conflicts with the current state (`conflict`). */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests (`rate_limited`). `Retry-After` says when to try again. */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Server error (`internal_error`). */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    createMailboxDkimKey: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description The mailbox. */
                mailboxId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CreateMailboxDkimKey"];
            };
        };
        responses: {
            /** @description The mailbox, with the record to publish. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Mailbox"];
                };
            };
            /** @description The request is invalid (`validation_failed`). */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description No valid session or API key (`unauthorized`). */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description A required scope or role is missing (`forbidden_scope`). */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The resource does not exist in this workspace (`not_found`). */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The request conflicts with the current state (`conflict`). */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests (`rate_limited`). `Retry-After` says when to try again. */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Server error (`internal_error`). */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    deleteMailboxDkimKey: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description The mailbox. */
                mailboxId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The mailbox. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Mailbox"];
                };
            };
            /** @description The request is invalid (`validation_failed`). */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description No valid session or API key (`unauthorized`). */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description A required scope or role is missing (`forbidden_scope`). */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The resource does not exist in this workspace (`not_found`). */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The request conflicts with the current state (`conflict`). */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests (`rate_limited`). `Retry-After` says when to try again. */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Server error (`internal_error`). */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    testMailboxConnection: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description The mailbox. */
                mailboxId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The checklist. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ConnectionTest"];
                };
            };
            /** @description The request is invalid (`validation_failed`). */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description No valid session or API key (`unauthorized`). */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description A required scope or role is missing (`forbidden_scope`). */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The resource does not exist in this workspace (`not_found`). */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests (`rate_limited`). `Retry-After` says when to try again. */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Server error (`internal_error`). */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    pollMailboxNow: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description The mailbox. */
                mailboxId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The poll is queued. */
            202: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PollQueued"];
                };
            };
            /** @description The request is invalid (`validation_failed`). */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description No valid session or API key (`unauthorized`). */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description A required scope or role is missing (`forbidden_scope`). */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The resource does not exist in this workspace (`not_found`). */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The request conflicts with the current state (`conflict`). */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests (`rate_limited`). `Retry-After` says when to try again. */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Server error (`internal_error`). */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    getDeliverabilityOverview: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The overview. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DeliverabilityOverview"];
                };
            };
            /** @description No valid session or API key (`unauthorized`). */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description A required scope or role is missing (`forbidden_scope`). */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests (`rate_limited`). `Retry-After` says when to try again. */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Server error (`internal_error`). */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    getSendingCapacity: {
        parameters: {
            query?: {
                /** @description Only this domain and its mailboxes. */
                domain_id?: string;
                /** @description Only this mailbox. */
                mailbox_id?: string;
                /** @description Only this campaign. */
                campaign_id?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The plan. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SendingCapacity"];
                };
            };
            /** @description The request is invalid (`validation_failed`). */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description No valid session or API key (`unauthorized`). */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description A required scope or role is missing (`forbidden_scope`). */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests (`rate_limited`). `Retry-After` says when to try again. */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Server error (`internal_error`). */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    listPollRuns: {
        parameters: {
            query?: {
                /** @description Page size, 1 to 100. */
                limit?: number;
                /** @description The `next_cursor` of the previous page. Omit for the first page. */
                cursor?: string;
            };
            header?: never;
            path: {
                /** @description The mailbox. */
                mailboxId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description A page of poll runs. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PollRunPage"];
                };
            };
            /** @description The request is invalid (`validation_failed`). */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description No valid session or API key (`unauthorized`). */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description A required scope or role is missing (`forbidden_scope`). */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The resource does not exist in this workspace (`not_found`). */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests (`rate_limited`). `Retry-After` says when to try again. */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Server error (`internal_error`). */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    getMailboxStats: {
        parameters: {
            query?: {
                /** @description How many days back, 1 to 90. */
                days?: number;
            };
            header?: never;
            path: {
                /** @description The mailbox. */
                mailboxId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The stats. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MailboxStats"];
                };
            };
            /** @description The request is invalid (`validation_failed`). */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description No valid session or API key (`unauthorized`). */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description A required scope or role is missing (`forbidden_scope`). */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The resource does not exist in this workspace (`not_found`). */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests (`rate_limited`). `Retry-After` says when to try again. */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Server error (`internal_error`). */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    listDomains: {
        parameters: {
            query?: {
                /** @description Page size, 1 to 100. */
                limit?: number;
                /** @description The `next_cursor` of the previous page. Omit for the first page. */
                cursor?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description A page of domains. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DomainPage"];
                };
            };
            /** @description The request is invalid (`validation_failed`). */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description No valid session or API key (`unauthorized`). */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description A required scope or role is missing (`forbidden_scope`). */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests (`rate_limited`). `Retry-After` says when to try again. */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Server error (`internal_error`). */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    createDomain: {
        parameters: {
            query?: never;
            header?: {
                /** @description A unique key for this request. Sending it again within 24 hours returns the stored response instead of acting twice. */
                "Idempotency-Key"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CreateDomain"];
            };
        };
        responses: {
            /** @description The domain that was added. */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Domain"];
                };
            };
            /** @description The request is invalid (`validation_failed`). */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description No valid session or API key (`unauthorized`). */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description A required scope or role is missing (`forbidden_scope`). */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The request conflicts with the current state (`conflict`). */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The request cannot be carried out as sent (`idempotency_key_reused`, `send_blocked`). */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests (`rate_limited`). `Retry-After` says when to try again. */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Server error (`internal_error`). */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    getDomain: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description The sending domain. */
                domainId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The domain. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Domain"];
                };
            };
            /** @description The request is invalid (`validation_failed`). */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description No valid session or API key (`unauthorized`). */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description A required scope or role is missing (`forbidden_scope`). */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The resource does not exist in this workspace (`not_found`). */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests (`rate_limited`). `Retry-After` says when to try again. */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Server error (`internal_error`). */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    deleteDomain: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description The sending domain. */
                domainId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The domain was removed. */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description The request is invalid (`validation_failed`). */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description No valid session or API key (`unauthorized`). */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description A required scope or role is missing (`forbidden_scope`). */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The resource does not exist in this workspace (`not_found`). */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The request conflicts with the current state (`conflict`). */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests (`rate_limited`). `Retry-After` says when to try again. */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Server error (`internal_error`). */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    checkDomainDns: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description The sending domain. */
                domainId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The domain with its new check. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Domain"];
                };
            };
            /** @description The request is invalid (`validation_failed`). */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description No valid session or API key (`unauthorized`). */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description A required scope or role is missing (`forbidden_scope`). */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The resource does not exist in this workspace (`not_found`). */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests (`rate_limited`). `Retry-After` says when to try again. */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Server error (`internal_error`). */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    resumeDomainFirstTouches: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description The sending domain. */
                domainId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ResumeDomainFirstTouches"];
            };
        };
        responses: {
            /** @description The domain, sending first emails again. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Domain"];
                };
            };
            /** @description The request is invalid (`validation_failed`). */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description No valid session or API key (`unauthorized`). */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description A required scope or role is missing (`forbidden_scope`). */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The resource does not exist in this workspace (`not_found`). */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The request conflicts with the current state (`conflict`). */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests (`rate_limited`). `Retry-After` says when to try again. */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Server error (`internal_error`). */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    getDomainReputation: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description The sending domain. */
                domainId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The reputation. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DomainReputation"];
                };
            };
            /** @description The request is invalid (`validation_failed`). */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description No valid session or API key (`unauthorized`). */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description A required scope or role is missing (`forbidden_scope`). */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The resource does not exist in this workspace (`not_found`). */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests (`rate_limited`). `Retry-After` says when to try again. */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Server error (`internal_error`). */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    getDomainRamp: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description The sending domain. */
                domainId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The ramp. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DomainRamp"];
                };
            };
            /** @description The request is invalid (`validation_failed`). */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description No valid session or API key (`unauthorized`). */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description A required scope or role is missing (`forbidden_scope`). */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The resource does not exist in this workspace (`not_found`). */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests (`rate_limited`). `Retry-After` says when to try again. */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Server error (`internal_error`). */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    updateDomainRamp: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description The sending domain. */
                domainId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["UpdateDomainRamp"];
            };
        };
        responses: {
            /** @description The ramp after the change. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DomainRamp"];
                };
            };
            /** @description The request is invalid (`validation_failed`). */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description No valid session or API key (`unauthorized`). */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description A required scope or role is missing (`forbidden_scope`). */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The resource does not exist in this workspace (`not_found`). */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The request conflicts with the current state (`conflict`). */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests (`rate_limited`). `Retry-After` says when to try again. */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Server error (`internal_error`). */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    holdDomainRamp: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description The sending domain. */
                domainId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["RampAction"];
            };
        };
        responses: {
            /** @description The ramp after the change. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DomainRamp"];
                };
            };
            /** @description The request is invalid (`validation_failed`). */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description No valid session or API key (`unauthorized`). */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description A required scope or role is missing (`forbidden_scope`). */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The resource does not exist in this workspace (`not_found`). */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The request conflicts with the current state (`conflict`). */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests (`rate_limited`). `Retry-After` says when to try again. */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Server error (`internal_error`). */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    resumeDomainRamp: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description The sending domain. */
                domainId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["RampAction"];
            };
        };
        responses: {
            /** @description The ramp after the change. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DomainRamp"];
                };
            };
            /** @description The request is invalid (`validation_failed`). */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description No valid session or API key (`unauthorized`). */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description A required scope or role is missing (`forbidden_scope`). */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The resource does not exist in this workspace (`not_found`). */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The request conflicts with the current state (`conflict`). */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests (`rate_limited`). `Retry-After` says when to try again. */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Server error (`internal_error`). */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    stepBackDomainRamp: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description The sending domain. */
                domainId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["StepBackDomainRamp"];
            };
        };
        responses: {
            /** @description The ramp after the change. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DomainRamp"];
                };
            };
            /** @description The request is invalid (`validation_failed`). */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description No valid session or API key (`unauthorized`). */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description A required scope or role is missing (`forbidden_scope`). */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The resource does not exist in this workspace (`not_found`). */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The request conflicts with the current state (`conflict`). */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests (`rate_limited`). `Retry-After` says when to try again. */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Server error (`internal_error`). */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    setDomainCapOverride: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description The sending domain. */
                domainId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["SetDomainCapOverride"];
            };
        };
        responses: {
            /** @description The ramp with the override. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DomainRamp"];
                };
            };
            /** @description The request is invalid (`validation_failed`). */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description No valid session or API key (`unauthorized`). */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description A required scope or role is missing (`forbidden_scope`). */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The resource does not exist in this workspace (`not_found`). */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests (`rate_limited`). `Retry-After` says when to try again. */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Server error (`internal_error`). */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    clearDomainCapOverride: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description The sending domain. */
                domainId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The override was removed. */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description The request is invalid (`validation_failed`). */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description No valid session or API key (`unauthorized`). */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description A required scope or role is missing (`forbidden_scope`). */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The resource does not exist in this workspace (`not_found`). */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The request conflicts with the current state (`conflict`). */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests (`rate_limited`). `Retry-After` says when to try again. */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Server error (`internal_error`). */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    listWebhookEndpoints: {
        parameters: {
            query?: {
                /** @description Page size, 1 to 100. */
                limit?: number;
                /** @description The `next_cursor` of the previous page. Omit for the first page. */
                cursor?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description A page of endpoints. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["WebhookEndpointPage"];
                };
            };
            /** @description The request is invalid (`validation_failed`). */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description No valid session or API key (`unauthorized`). */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description A required scope or role is missing (`forbidden_scope`). */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests (`rate_limited`). `Retry-After` says when to try again. */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Server error (`internal_error`). */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    createWebhookEndpoint: {
        parameters: {
            query?: never;
            header?: {
                /** @description A unique key for this request. Sending it again within 24 hours returns the stored response instead of acting twice. */
                "Idempotency-Key"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /**
                     * Format: uri
                     * @description An https URL on a public address; private and local addresses are refused (§13.6).
                     * @example https://hooks.getacme.com/catalyst
                     */
                    url: string;
                    /** @description What it is for. */
                    description?: string;
                    /** @description The events to receive. */
                    events: components["schemas"]["WebhookEventType"][];
                };
            };
        };
        responses: {
            /** @description The endpoint, with its secret. */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["WebhookEndpointCreated"];
                };
            };
            /** @description The request is invalid (`validation_failed`). */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description No valid session or API key (`unauthorized`). */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description A required scope or role is missing (`forbidden_scope`). */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The request cannot be carried out as sent (`idempotency_key_reused`, `send_blocked`). */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests (`rate_limited`). `Retry-After` says when to try again. */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Server error (`internal_error`). */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    deleteWebhookEndpoint: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description The endpoint. */
                endpointId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Deleted. */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description The request is invalid (`validation_failed`). */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description No valid session or API key (`unauthorized`). */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description A required scope or role is missing (`forbidden_scope`). */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The resource does not exist in this workspace (`not_found`). */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests (`rate_limited`). `Retry-After` says when to try again. */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Server error (`internal_error`). */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    updateWebhookEndpoint: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description The endpoint. */
                endpointId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /**
                     * Format: uri
                     * @description An https URL on a public address; private and local addresses are refused (§13.6).
                     * @example https://hooks.getacme.com/catalyst
                     */
                    url?: string;
                    /** @description What it is for. */
                    description?: string | null;
                    /** @description The events to receive. */
                    events?: components["schemas"]["WebhookEventType"][];
                    /** @description Receiving events. */
                    active?: boolean;
                };
            };
        };
        responses: {
            /** @description The endpoint. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["WebhookEndpoint"];
                };
            };
            /** @description The request is invalid (`validation_failed`). */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description No valid session or API key (`unauthorized`). */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description A required scope or role is missing (`forbidden_scope`). */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The resource does not exist in this workspace (`not_found`). */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests (`rate_limited`). `Retry-After` says when to try again. */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Server error (`internal_error`). */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    testWebhookEndpoint: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description The endpoint. */
                endpointId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The test delivery. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["WebhookDelivery"];
                };
            };
            /** @description The request is invalid (`validation_failed`). */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description No valid session or API key (`unauthorized`). */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description A required scope or role is missing (`forbidden_scope`). */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The resource does not exist in this workspace (`not_found`). */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests (`rate_limited`). `Retry-After` says when to try again. */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Server error (`internal_error`). */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    listWebhookDeliveries: {
        parameters: {
            query?: {
                /** @description Page size, 1 to 100. */
                limit?: number;
                /** @description The `next_cursor` of the previous page. Omit for the first page. */
                cursor?: string;
                /** @description Only this status. */
                status?: "pending" | "delivered" | "failed" | "skipped";
            };
            header?: never;
            path: {
                /** @description The endpoint. */
                endpointId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description A page of deliveries. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["WebhookDeliveryPage"];
                };
            };
            /** @description The request is invalid (`validation_failed`). */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description No valid session or API key (`unauthorized`). */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description A required scope or role is missing (`forbidden_scope`). */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The resource does not exist in this workspace (`not_found`). */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests (`rate_limited`). `Retry-After` says when to try again. */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Server error (`internal_error`). */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    redeliverWebhook: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description The delivery. */
                deliveryId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Queued. */
            202: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["WebhookDelivery"];
                };
            };
            /** @description The request is invalid (`validation_failed`). */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description No valid session or API key (`unauthorized`). */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description A required scope or role is missing (`forbidden_scope`). */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The resource does not exist in this workspace (`not_found`). */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The request conflicts with the current state (`conflict`). */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests (`rate_limited`). `Retry-After` says when to try again. */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Server error (`internal_error`). */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    listIntegrations: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The integrations. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["IntegrationList"];
                };
            };
            /** @description No valid session or API key (`unauthorized`). */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description A required scope or role is missing (`forbidden_scope`). */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests (`rate_limited`). `Retry-After` says when to try again. */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Server error (`internal_error`). */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    createIntegration: {
        parameters: {
            query?: never;
            header?: {
                /** @description A unique key for this request. Sending it again within 24 hours returns the stored response instead of acting twice. */
                "Idempotency-Key"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    kind: components["schemas"]["IntegrationKind"];
                    /** @description The provider’s webhook signing secret; required except for `generic`. */
                    signing_secret?: string;
                };
            };
        };
        responses: {
            /** @description The integration; `secret` only for `generic`. */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["IntegrationCreated"];
                };
            };
            /** @description The request is invalid (`validation_failed`). */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description No valid session or API key (`unauthorized`). */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description A required scope or role is missing (`forbidden_scope`). */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The request cannot be carried out as sent (`idempotency_key_reused`, `send_blocked`). */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests (`rate_limited`). `Retry-After` says when to try again. */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Server error (`internal_error`). */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    deleteIntegration: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description The integration. */
                integrationId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Disconnected. */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description The request is invalid (`validation_failed`). */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description No valid session or API key (`unauthorized`). */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description A required scope or role is missing (`forbidden_scope`). */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The resource does not exist in this workspace (`not_found`). */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests (`rate_limited`). `Retry-After` says when to try again. */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Server error (`internal_error`). */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    listIntegrationEvents: {
        parameters: {
            query?: {
                /** @description Page size, 1 to 100. */
                limit?: number;
                /** @description The `next_cursor` of the previous page. Omit for the first page. */
                cursor?: string;
                /** @description Only this outcome. */
                outcome?: components["schemas"]["IntegrationOutcome"];
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description A page of events. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["IntegrationEventPage"];
                };
            };
            /** @description The request is invalid (`validation_failed`). */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description No valid session or API key (`unauthorized`). */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description A required scope or role is missing (`forbidden_scope`). */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests (`rate_limited`). `Retry-After` says when to try again. */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Server error (`internal_error`). */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    attachIntegrationEvent: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description The event. */
                eventId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /**
                     * @description The thread.
                     * @example thr_01jd3x5k8qf7tb9w2m4n6p8r0s
                     */
                    thread_id: string;
                    /**
                     * @description The goal it achieves.
                     * @example gol_01jd3x5k8qf7tb9w2m4n6p8r0s
                     */
                    goal_id: string;
                };
            };
        };
        responses: {
            /** @description The event. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["IntegrationEvent"];
                };
            };
            /** @description The request is invalid (`validation_failed`). */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description No valid session or API key (`unauthorized`). */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description A required scope or role is missing (`forbidden_scope`). */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The resource does not exist in this workspace (`not_found`). */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The request conflicts with the current state (`conflict`). */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests (`rate_limited`). `Retry-After` says when to try again. */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Server error (`internal_error`). */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    ingestIntegrationEvent: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /**
                     * @description Your system’s name.
                     * @example billing
                     */
                    source: string;
                    /**
                     * @description What happened.
                     * @example subscription.started
                     */
                    type: string;
                    /** @description Your ID for the event, for deduplication. */
                    external_id: string;
                    /**
                     * Format: email
                     * @description Who it is about.
                     */
                    contact_email: string;
                    /** @description The campaign goal’s key, e.g. `paid`. */
                    goal_key?: string;
                    /** @description Its value, in cents. */
                    value_cents?: number;
                    /**
                     * Format: date-time
                     * @description When it happened (a meeting’s start, a payment’s time).
                     */
                    occurred_at: string;
                };
            };
        };
        responses: {
            /** @description Received. */
            202: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["IntegrationEventReceived"];
                };
            };
            /** @description The request is invalid (`validation_failed`). */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The resource does not exist in this workspace (`not_found`). */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests (`rate_limited`). `Retry-After` says when to try again. */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Server error (`internal_error`). */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    receiveStripeWebhook: {
        parameters: {
            query: {
                /** @description The Stripe integration. */
                integration_id: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Received. */
            202: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["IntegrationEventReceived"];
                };
            };
            /** @description The request is invalid (`validation_failed`). */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The resource does not exist in this workspace (`not_found`). */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests (`rate_limited`). `Retry-After` says when to try again. */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Server error (`internal_error`). */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    receiveCalcomWebhook: {
        parameters: {
            query: {
                /** @description The Cal.com integration. */
                integration_id: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Received. */
            202: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["IntegrationEventReceived"];
                };
            };
            /** @description The request is invalid (`validation_failed`). */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The resource does not exist in this workspace (`not_found`). */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests (`rate_limited`). `Retry-After` says when to try again. */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Server error (`internal_error`). */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    receiveCalendlyWebhook: {
        parameters: {
            query: {
                /** @description The Calendly integration. */
                integration_id: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Received. */
            202: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["IntegrationEventReceived"];
                };
            };
            /** @description The request is invalid (`validation_failed`). */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The resource does not exist in this workspace (`not_found`). */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests (`rate_limited`). `Retry-After` says when to try again. */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Server error (`internal_error`). */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    getDashboardOverview: {
        parameters: {
            query?: {
                /** @description The period, in days. */
                days?: number;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The overview. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DashboardOverview"];
                };
            };
            /** @description The request is invalid (`validation_failed`). */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description No valid session or API key (`unauthorized`). */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description A required scope or role is missing (`forbidden_scope`). */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests (`rate_limited`). `Retry-After` says when to try again. */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Server error (`internal_error`). */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    getFunnel: {
        parameters: {
            query?: {
                /** @description Only this campaign. */
                campaign_id?: string;
                /** @description Only threads first emailed in the last this many days. */
                days?: number;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The funnel. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["FunnelResult"];
                };
            };
            /** @description The request is invalid (`validation_failed`). */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description No valid session or API key (`unauthorized`). */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description A required scope or role is missing (`forbidden_scope`). */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The resource does not exist in this workspace (`not_found`). */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests (`rate_limited`). `Retry-After` says when to try again. */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Server error (`internal_error`). */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    getCampaignStats: {
        parameters: {
            query?: {
                /** @description Only the last this many days. */
                days?: number;
            };
            header?: never;
            path: {
                /** @description The campaign. */
                campaignId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The stats. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CampaignStats"];
                };
            };
            /** @description The request is invalid (`validation_failed`). */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description No valid session or API key (`unauthorized`). */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description A required scope or role is missing (`forbidden_scope`). */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The resource does not exist in this workspace (`not_found`). */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests (`rate_limited`). `Retry-After` says when to try again. */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Server error (`internal_error`). */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    listKnowledgeGaps: {
        parameters: {
            query?: {
                /** @description Only questions asked in the last this many days. */
                days?: number;
                /** @description Only this campaign. */
                campaign_id?: string;
                /** @description Most questions to return, 1 to 200. */
                limit?: number;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The questions. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["KnowledgeGaps"];
                };
            };
            /** @description The request is invalid (`validation_failed`). */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description No valid session or API key (`unauthorized`). */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description A required scope or role is missing (`forbidden_scope`). */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests (`rate_limited`). `Retry-After` says when to try again. */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Server error (`internal_error`). */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    listKnowledgeItems: {
        parameters: {
            query?: {
                /** @description Page size, 1 to 100. */
                limit?: number;
                /** @description The `next_cursor` of the previous page. Omit for the first page. */
                cursor?: string;
                /** @description `workspace` for workspace-wide items, or a campaign ID for that campaign’s own. */
                scope?: string;
                /** @description Only this kind. */
                kind?: components["schemas"]["KnowledgeKind"];
                /** @description Only this source. */
                source?: "manual" | "escalation" | "import" | "api";
                /** @description Only active (true) or inactive (false) items. */
                active?: "true" | "false";
                /** @description Text in the title or content. */
                q?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description A page of items. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["KnowledgeItemPage"];
                };
            };
            /** @description The request is invalid (`validation_failed`). */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description No valid session or API key (`unauthorized`). */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description A required scope or role is missing (`forbidden_scope`). */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests (`rate_limited`). `Retry-After` says when to try again. */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Server error (`internal_error`). */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    createKnowledgeItem: {
        parameters: {
            query?: never;
            header?: {
                /** @description A unique key for this request. Sending it again within 24 hours returns the stored response instead of acting twice. */
                "Idempotency-Key"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    kind: components["schemas"]["KnowledgeKind"];
                    /** @description A short title, often the question. */
                    title: string;
                    /** @description Markdown; for shareable items, written so the agent can quote it. */
                    content: string;
                    campaign_id?: string | null;
                    /** @default shareable */
                    visibility?: components["schemas"]["KnowledgeVisibility"];
                    /**
                     * @description Free-form tags.
                     * @default []
                     */
                    tags?: string[];
                    /**
                     * @description Used by the agent.
                     * @default true
                     */
                    active?: boolean;
                };
            };
        };
        responses: {
            /** @description The item. */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["KnowledgeItem"];
                };
            };
            /** @description The request is invalid (`validation_failed`). */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description No valid session or API key (`unauthorized`). */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description A required scope or role is missing (`forbidden_scope`). */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The request cannot be carried out as sent (`idempotency_key_reused`, `send_blocked`). */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests (`rate_limited`). `Retry-After` says when to try again. */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Server error (`internal_error`). */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    getKnowledgeItem: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description The knowledge item. */
                itemId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The item. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["KnowledgeItem"];
                };
            };
            /** @description The request is invalid (`validation_failed`). */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description No valid session or API key (`unauthorized`). */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description A required scope or role is missing (`forbidden_scope`). */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The resource does not exist in this workspace (`not_found`). */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests (`rate_limited`). `Retry-After` says when to try again. */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Server error (`internal_error`). */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    deleteKnowledgeItem: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description The knowledge item. */
                itemId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Deleted. */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description The request is invalid (`validation_failed`). */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description No valid session or API key (`unauthorized`). */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description A required scope or role is missing (`forbidden_scope`). */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The resource does not exist in this workspace (`not_found`). */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests (`rate_limited`). `Retry-After` says when to try again. */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Server error (`internal_error`). */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    updateKnowledgeItem: {
        parameters: {
            query?: never;
            header?: {
                /** @description The `ETag` from your last GET of this resource. The change is refused if the resource has changed since. */
                "If-Match"?: string;
            };
            path: {
                /** @description The knowledge item. */
                itemId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    kind?: components["schemas"]["KnowledgeKind"];
                    /** @description A short title, often the question. */
                    title?: string;
                    /** @description Markdown; for shareable items, written so the agent can quote it. */
                    content?: string;
                    campaign_id?: string | null;
                    visibility?: components["schemas"]["KnowledgeVisibility"];
                    /** @description Free-form tags. */
                    tags?: string[];
                    /** @description Used by the agent. */
                    active?: boolean;
                };
            };
        };
        responses: {
            /** @description The item. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["KnowledgeItem"];
                };
            };
            /** @description The request is invalid (`validation_failed`). */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description No valid session or API key (`unauthorized`). */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description A required scope or role is missing (`forbidden_scope`). */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The resource does not exist in this workspace (`not_found`). */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The `If-Match` ETag is stale (`precondition_failed`). */
            412: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests (`rate_limited`). `Retry-After` says when to try again. */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Server error (`internal_error`). */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    testKnowledge: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /** @description The question, as a prospect would write it. */
                    question: string;
                    /**
                     * @description Test against this campaign’s knowledge and links; without it, the workspace’s.
                     * @example cmp_01jd3x5k8qf7tb9w2m4n6p8r0s
                     */
                    campaign_id?: string;
                };
            };
        };
        responses: {
            /** @description The agent’s answer. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["KnowledgeTest"];
                };
            };
            /** @description The request is invalid (`validation_failed`). */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description No valid session or API key (`unauthorized`). */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description A required scope or role is missing (`forbidden_scope`). */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests (`rate_limited`). `Retry-After` says when to try again. */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Server error (`internal_error`). */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The AI agent is off, failed or is over budget (`ai_unavailable`, `budget_exceeded`). */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    getWorkspaceSettings: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The settings. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["WorkspaceSettings"];
                };
            };
            /** @description No valid session or API key (`unauthorized`). */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description A required scope or role is missing (`forbidden_scope`). */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests (`rate_limited`). `Retry-After` says when to try again. */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Server error (`internal_error`). */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    updateWorkspaceSettings: {
        parameters: {
            query?: never;
            header?: {
                /** @description The `ETag` from your last GET of this resource. The change is refused if the resource has changed since. */
                "If-Match"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /** @description The workspace’s name. */
                    name?: string;
                    /** @description A postal address (CAN-SPAM). */
                    physical_address?: string;
                    /**
                     * @description An IANA zone.
                     * @example Europe/Berlin
                     */
                    default_timezone?: string;
                    business_hours?: components["schemas"]["BusinessHours"];
                    notifications?: {
                        /** @description A Slack incoming-webhook URL for alerts, or null to stop. Stored encrypted. */
                        slack_webhook_url?: string | null;
                        quiet_hours?: components["schemas"]["QuietHours"] | null;
                    };
                    ai?: {
                        /**
                         * @description USD a calendar month, or null for no cap. Raising it restarts a stopped agent at once.
                         * @example 200
                         */
                        monthly_budget_usd?: number | null;
                        /**
                         * @description Per-task overrides; null puts a task back on the default. Move `analyze_inbound` to a smaller model only once the evals show parity (§10.2).
                         * @example {
                         *       "analyze_inbound": {
                         *         "model": "claude-haiku-5-5"
                         *       }
                         *     }
                         */
                        tasks?: {
                            [key: string]: {
                                /**
                                 * @description A Claude model ID whose prices Catalyst knows, so its runs count against the budget.
                                 * @example claude-haiku-5-5
                                 */
                                model?: string;
                                effort?: components["schemas"]["Effort"];
                            } | null;
                        };
                        disclosure?: components["schemas"]["AiDisclosure"];
                        /**
                         * @description Pin this workspace to a Jev version (never jev-latest); null follows the server’s. Move only once the evals pass (§19.7).
                         * @example jev-1.14.0
                         */
                        jev_model?: string | null;
                        /**
                         * @description Overrides of §22.B’s thresholds, merged with the current ones; null goes back to the defaults. Each ask band must stay below its act band, and mandatory escalations can’t be made harder to raise.
                         * @example {
                         *       "autoSendIntent": 0.8
                         *     }
                         */
                        thresholds?: {
                            [key: string]: number;
                        } | null;
                    };
                    security?: {
                        /** @description Require owners to sign in with two-factor authentication. Each owner without it can then do nothing but set it up. */
                        require_owner_two_factor?: boolean;
                    };
                };
            };
        };
        responses: {
            /** @description The settings. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["WorkspaceSettings"];
                };
            };
            /** @description The request is invalid (`validation_failed`). */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description No valid session or API key (`unauthorized`). */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description A required scope or role is missing (`forbidden_scope`). */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The `If-Match` ETag is stale (`precondition_failed`). */
            412: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests (`rate_limited`). `Retry-After` says when to try again. */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Server error (`internal_error`). */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    listUsers: {
        parameters: {
            query?: {
                /** @description Page size, 1 to 100. */
                limit?: number;
                /** @description The `next_cursor` of the previous page. Omit for the first page. */
                cursor?: string;
                /** @description Also people removed from the team. */
                include_removed?: "true" | "false";
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description A page of people. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UserPage"];
                };
            };
            /** @description The request is invalid (`validation_failed`). */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description No valid session or API key (`unauthorized`). */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description A required scope or role is missing (`forbidden_scope`). */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests (`rate_limited`). `Retry-After` says when to try again. */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Server error (`internal_error`). */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    inviteUser: {
        parameters: {
            query?: never;
            header?: {
                /** @description A unique key for this request. Sending it again within 24 hours returns the stored response instead of acting twice. */
                "Idempotency-Key"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /**
                     * Format: email
                     * @description Their work email.
                     */
                    email: string;
                    name: string;
                    role: components["schemas"]["UserRole"];
                };
            };
        };
        responses: {
            /** @description The person. */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["User"];
                };
            };
            /** @description The request is invalid (`validation_failed`). */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description No valid session or API key (`unauthorized`). */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description A required scope or role is missing (`forbidden_scope`). */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The request conflicts with the current state (`conflict`). */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The request cannot be carried out as sent (`idempotency_key_reused`, `send_blocked`). */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests (`rate_limited`). `Retry-After` says when to try again. */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Server error (`internal_error`). */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    removeUser: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description The person. */
                userId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Removed. */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description The request is invalid (`validation_failed`). */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description No valid session or API key (`unauthorized`). */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description A required scope or role is missing (`forbidden_scope`). */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The resource does not exist in this workspace (`not_found`). */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The request conflicts with the current state (`conflict`). */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests (`rate_limited`). `Retry-After` says when to try again. */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Server error (`internal_error`). */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    updateUser: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description The person. */
                userId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    name?: string;
                    role?: components["schemas"]["UserRole"];
                    /** @description An IANA zone, or null for the workspace’s. */
                    timezone?: string | null;
                    /** @description Which mail they get. */
                    notifications?: {
                        email?: boolean;
                        digest?: boolean;
                    };
                };
            };
        };
        responses: {
            /** @description The person. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["User"];
                };
            };
            /** @description The request is invalid (`validation_failed`). */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description No valid session or API key (`unauthorized`). */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description A required scope or role is missing (`forbidden_scope`). */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The resource does not exist in this workspace (`not_found`). */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The request conflicts with the current state (`conflict`). */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests (`rate_limited`). `Retry-After` says when to try again. */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Server error (`internal_error`). */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    listApiKeys: {
        parameters: {
            query?: {
                /** @description Also list revoked keys. */
                include_revoked?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The keys. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiKeyList"];
                };
            };
            /** @description The request is invalid (`validation_failed`). */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description No valid session or API key (`unauthorized`). */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description A required scope or role is missing (`forbidden_scope`). */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests (`rate_limited`). `Retry-After` says when to try again. */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Server error (`internal_error`). */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    createApiKey: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CreateApiKey"];
            };
        };
        responses: {
            /** @description The key, with its secret. */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CreatedApiKey"];
                };
            };
            /** @description The request is invalid (`validation_failed`). */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description No valid session or API key (`unauthorized`). */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description A required scope or role is missing (`forbidden_scope`). */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests (`rate_limited`). `Retry-After` says when to try again. */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Server error (`internal_error`). */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    revokeApiKey: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description The key. */
                keyId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The revoked key. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiKey"];
                };
            };
            /** @description The request is invalid (`validation_failed`). */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description No valid session or API key (`unauthorized`). */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description A required scope or role is missing (`forbidden_scope`). */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The resource does not exist in this workspace (`not_found`). */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The request conflicts with the current state (`conflict`). */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests (`rate_limited`). `Retry-After` says when to try again. */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Server error (`internal_error`). */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    getAiUsage: {
        parameters: {
            query?: {
                /** @description How many days back, 1 to 90. */
                days?: number;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The usage. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AiUsage"];
                };
            };
            /** @description The request is invalid (`validation_failed`). */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description No valid session or API key (`unauthorized`). */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description A required scope or role is missing (`forbidden_scope`). */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests (`rate_limited`). `Retry-After` says when to try again. */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Server error (`internal_error`). */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    getPushSettings: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Push settings. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PushSettings"];
                };
            };
            /** @description No valid session or API key (`unauthorized`). */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description A required scope or role is missing (`forbidden_scope`). */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests (`rate_limited`). `Retry-After` says when to try again. */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Server error (`internal_error`). */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    createPushSubscription: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CreatePushSubscription"];
            };
        };
        responses: {
            /** @description The subscription. */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PushSubscription"];
                };
            };
            /** @description The request is invalid (`validation_failed`). */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description No valid session or API key (`unauthorized`). */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description A required scope or role is missing (`forbidden_scope`). */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The request conflicts with the current state (`conflict`). */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests (`rate_limited`). `Retry-After` says when to try again. */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Server error (`internal_error`). */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    deletePushSubscription: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description The subscription. */
                subscriptionId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Removed. */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description The request is invalid (`validation_failed`). */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description No valid session or API key (`unauthorized`). */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description A required scope or role is missing (`forbidden_scope`). */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description The resource does not exist in this workspace (`not_found`). */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Too many requests (`rate_limited`). `Retry-After` says when to try again. */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Server error (`internal_error`). */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
}
