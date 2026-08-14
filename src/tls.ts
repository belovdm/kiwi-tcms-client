/**
 * Отключение проверки TLS-сертификата для self-signed инстансов Kiwi TCMS
 * в закрытом контуре. Node's global fetch (undici) читает
 * NODE_TLS_REJECT_UNAUTHORIZED при установке соединения — это единственный
 * официально поддерживаемый способ, но он влияет на весь процесс, а не
 * только на запросы к Kiwi TCMS. Вызывайте только осознанно (флаг --insecure
 * / KIWI_INSECURE), никогда не включайте по умолчанию.
 */
export function applyInsecureTls(): void {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
}
