# Modern Med Clinic

## Pornire locală

```bash
npm start
```

Site-ul se deschide la:

```text
http://127.0.0.1:4177/modern-med-clinic-2.html
```

## Chestionar și recenzii

Backend-ul salvează răspunsurile în `backend/data/reviews.json`.

Comentariile curate sunt aprobate automat și intră în media stelelor. Comentariile cu limbaj nepotrivit sau ton agresiv rămân în starea `pending` și trimit un email cu subiectul `APROBARE recenzie Modern Med Clinic`, cu link de aprobare sau respingere.

Dacă pacientul completează emailul sau telefonul, datele ajung pe emailul clinicii cu subiectul `Recenzie Modern Med Clinic`. Recenzia publică rămâne anonimă.

## Email

Pentru trimitere reală de email, creează adresa `contact@modernmedclinic.ro` la providerul domeniului și configurează un serviciu de trimitere, de exemplu Resend:

```bash
export RESEND_API_KEY="..."
export REVIEW_TO="contact@modernmedclinic.ro"
export MAIL_FROM="Modern Med Clinic <contact@modernmedclinic.ro>"
export SITE_URL="https://modernmedclinic.ro"
npm start
```

Fără `RESEND_API_KEY`, emailurile sunt salvate local ca fișiere HTML în `backend/data/outbox`, ca să poți testa fluxul fără cont de email.
