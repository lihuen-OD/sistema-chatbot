# ADR-007 — Archivos privados con cuarentena y análisis; un archivo por trámite en V1

- Fecha: 19/10/2026
- Estado: Aceptada. Precisada por ADR-014: "exactamente un archivo por trámite" pasa a ser "un adjunto seleccionado y confirmado por envío". El trámite puede conservar hasta 3 candidatos (incluidos los reemplazados y rechazados), con retención acotada. `minCount`/`maxCount` = 1 se refiere a adjuntos por envío.
- Responsable: propietario del proyecto
- Revisión: si el piloto muestra demanda de varios archivos u otros formatos; al elegir scanner y almacenamiento de producción (P5/P7).

## Contexto

Los documentos pueden ser sensibles o maliciosos. El kit original proponía "hasta 3 archivos por trámite" (`docs/02_ARQUITECTURA.md` §8), mientras que el ejemplo y las preguntas pendientes usaban uno. El propietario fijó V1 en un archivo PDF, JPG o PNG de hasta 10 MB por trámite.

## Alternativas

| Alternativa | Evaluación |
|---|---|
| Varios archivos con acción "Terminé de adjuntar" | Postergada: agrega estados y ambigüedad de interacción |
| Un archivo por trámite | Elegida para V1 |
| Admitir Word/Excel u otros formatos | Postergada: requieren validaciones específicas |

## Decisión

- V1: exactamente un archivo por trámite, PDF, JPG o PNG, hasta 10 MB (10.485.760 bytes). El esquema conserva `minCount`/`maxCount`, pero el validador V1 exige 1/1.
- La URL de media se obtiene solo del adaptador de Meta. Descarga por streaming con límite de bytes y de tiempo, HTTPS, hosts permitidos, control de redirecciones y bloqueo de destinos de red internos.
- Almacenamiento privado con clave aleatoria sin datos personales. Estados (código / etiqueta): `RECEIVED` Recibido, `QUARANTINED` En cuarentena, `SCANNING` Analizando, `APPROVED` Aprobado, `REJECTED` Rechazado, `SCAN_INCONCLUSIVE` Análisis incierto, `DELETED` Eliminado.
- Solo `APPROVED` puede adjuntarse a una entrega. Si el scanner está caído, el documento sigue pendiente. Un resultado inconcluso o un archivo cifrado se rechaza o pasa a revisión, nunca se aprueba automáticamente.
- Tipo real por firma de bytes, coherente con la extensión y el MIME declarado.
- Desarrollo: adaptador de carpeta privada local fuera del control de versiones (`/storage/` ignorado) y scanner simulado etiquetado; la configuración de producción rechaza ambos. Producción: almacenamiento de objetos privado compatible con S3 y scanner aislado, ambos a elegir con costo en P5/P7.
- No se incorpora MinIO para desarrollo. Según la revisión del 14/10/2026, su edición comunitaria no tiene mantenimiento activo; una carpeta local cubre las necesidades locales.
- El hash del archivo sirve para alertar duplicados; no bloquea de forma global que dos trámites legítimos adjunten el mismo documento.
- Retención propuesta de 30 días, pendiente de aprobación.
- Codificar el adjunto aumenta su tamaño (base64, alrededor de un tercio más): el límite del proveedor de correo debe admitir el archivo codificado. Se verifica en P5.

## Costos

Scanner aislado con recursos dedicados en producción. Almacenamiento de objetos y backups con costo a presupuestar.

## Consecuencias

Ver ADR-013 para las consecuencias del recorte a un archivo.

## Invariantes

- Ningún archivo no aprobado se distribuye.
- Ningún bucket es público; las URL firmadas se emiten después de autorizar.
- Ningún contenido de documento se escribe en logs.

## Pruebas

T13–T17 con archivos reales en P5 (no las reemplaza el simulador de P3, ver ADR-005) y T27.

## Documentos afectados

`docs/02_ARQUITECTURA.md` §8, `docs/06_EDITOR_Y_MOTOR.md`, `docs/07_SEGURIDAD.md`, `docs/10_ENTORNOS_Y_OPERACION.md`.
