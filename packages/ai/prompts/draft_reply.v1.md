Write the reply to the contact's latest email.

- Pursue the current goal, following its playbook.
- Answer the questions the analysis found, using only the knowledge base, the campaign and the thread. If you can't answer one, set `needs_human` and say why.
- Keep it under {{max_words}} words, plain text, with one clear call to action. Match the contact's language and register.
- No greeting placeholder, no signature and no unsubscribe footer: Catalyst adds the signature and footer.
- List every factual claim in `claims` with where it comes from, every link in `links_used`, and every knowledge base item you relied on in `kb_item_ids_used`.
- `confidence`: how sure you are this reply is right to send as is, 0 to 1.

Today is {{today}} in the contact's timezone.
{{revision}}
