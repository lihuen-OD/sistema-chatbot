# Fuentes y límites

Consultadas para la arquitectura y el diálogo el 14/10/2026. Revalidar al implementar; SDKs, requisitos, tarifas y planes cambian.

- Meta Developer Hub y recursos gratuitos: https://whatsappbusiness.com/developers/developer-hub/
- Meta Cloud API, inicio: https://developers.facebook.com/documentation/business-messaging/whatsapp/get-started
- Webhooks: https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/overview
- Números: https://developers.facebook.com/documentation/business-messaging/whatsapp/business-phone-numbers/phone-numbers
- API de media, colección oficial de Meta: https://www.postman.com/meta/whatsapp-business-platform/folder/13382743-ecb27be5-4d27-4763-bbee-6a8002c04bf3
- OWASP cargas: https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html
- AWS outbox: https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/transactional-outbox.html
- PostgreSQL SKIP LOCKED: https://www.postgresql.org/docs/current/sql-select.htm
- SDK oficial archivado, solo referencia de firma: https://whatsapp.github.io/WhatsApp-Nodejs-SDK/api-reference/webhooks/start/

P0 (19/10/2026): no se repitieron consultas externas. Las afirmaciones de los ADR sobre el BSUID de Meta, los límites de mensajes interactivos, el mantenimiento de MinIO y la compatibilidad entre TypeScript y typescript-eslint vienen de la revisión del 14/10/2026. Se verifican con documentación oficial en la etapa que las usa (P1 para tooling, P6 para Meta) antes de depender de ellas.

El patrón outbox no garantiza una única entrega externa por sí solo. SKIP LOCKED no garantiza orden por conversación. Un archivo válido no es necesariamente inocuo: aplicar defensa en profundidad. Estas son consideraciones del diseño que requieren pruebas.

No se fija un presupuesto contractual ni versiones de dependencias. No se incluye asesoría legal ni certificación de seguridad. Los ejemplos JSON son ficticios y deben pasar el schema formal de P1 antes de usarse como fixtures ejecutables. El kit propone una arquitectura, no demuestra carga/seguridad ni conexión a Meta.
