-- P1-T3 · 0005: los candidatos no se borran.
-- Fuentes: ADR-014 §2 y docs/04_MODELO_DATOS.md.
--
-- El cupo de 3 candidatos es histórico: candidate_count no se devuelve (0003) y cada
-- candidate_seq se usa una sola vez. Borrar la fila de un candidato liberaría su candidate_seq para
-- otro archivo del mismo trámite. La purga del objeto se registra en la fila (status = 'DELETED' y
-- object_deleted_at) y la fila se conserva.

CREATE TRIGGER documents_no_delete
  BEFORE DELETE ON documents
  FOR EACH ROW EXECUTE FUNCTION sc_reject_change('documents_no_delete');

CREATE TRIGGER documents_no_truncate
  BEFORE TRUNCATE ON documents
  FOR EACH STATEMENT EXECUTE FUNCTION sc_reject_change('documents_no_delete');
