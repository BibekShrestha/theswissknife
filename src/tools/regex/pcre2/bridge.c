#define PCRE2_CODE_UNIT_WIDTH 16
#define PCRE2_STATIC

#include <emscripten/emscripten.h>
#include <stdint.h>
#include <stdlib.h>
#include <pcre2.h>

EMSCRIPTEN_KEEPALIVE uintptr_t tsk_compile(
  const uint16_t *pattern,
  uint32_t length,
  uint32_t options,
  int32_t *error_code,
  uint32_t *error_offset
) {
  PCRE2_SIZE offset = 0;
  pcre2_code *code = pcre2_compile(pattern, length, options, error_code, &offset, NULL);
  *error_offset = (uint32_t)offset;
  return (uintptr_t)code;
}

EMSCRIPTEN_KEEPALIVE void tsk_code_free(uintptr_t code) {
  pcre2_code_free((pcre2_code *)code);
}

EMSCRIPTEN_KEEPALIVE uintptr_t tsk_match_data_create(uintptr_t code) {
  return (uintptr_t)pcre2_match_data_create_from_pattern((pcre2_code *)code, NULL);
}

EMSCRIPTEN_KEEPALIVE void tsk_match_data_free(uintptr_t data) {
  pcre2_match_data_free((pcre2_match_data *)data);
}

EMSCRIPTEN_KEEPALIVE uintptr_t tsk_match_context_create(void) {
  pcre2_match_context *context = pcre2_match_context_create(NULL);
  if (context != NULL) {
    pcre2_set_match_limit(context, 1000000);
    pcre2_set_depth_limit(context, 1000);
    pcre2_set_heap_limit(context, 20000000);
  }
  return (uintptr_t)context;
}

EMSCRIPTEN_KEEPALIVE void tsk_match_context_free(uintptr_t context) {
  pcre2_match_context_free((pcre2_match_context *)context);
}

EMSCRIPTEN_KEEPALIVE int32_t tsk_match(
  uintptr_t code,
  const uint16_t *subject,
  uint32_t length,
  uint32_t start,
  uint32_t options,
  uintptr_t data,
  uintptr_t context
) {
  return pcre2_match(
    (pcre2_code *)code,
    subject,
    length,
    start,
    options,
    (pcre2_match_data *)data,
    (pcre2_match_context *)context
  );
}

EMSCRIPTEN_KEEPALIVE uint32_t tsk_ovector_count(uintptr_t data) {
  return pcre2_get_ovector_count((pcre2_match_data *)data);
}

EMSCRIPTEN_KEEPALIVE uintptr_t tsk_ovector_pointer(uintptr_t data) {
  return (uintptr_t)pcre2_get_ovector_pointer((pcre2_match_data *)data);
}

EMSCRIPTEN_KEEPALIVE int32_t tsk_pattern_info(uintptr_t code, uint32_t what, uintptr_t where) {
  return pcre2_pattern_info((pcre2_code *)code, what, (void *)where);
}

EMSCRIPTEN_KEEPALIVE int32_t tsk_substitute(
  uintptr_t code,
  const uint16_t *subject,
  uint32_t subject_length,
  const uint16_t *replacement,
  uint32_t replacement_length,
  uint32_t options,
  uintptr_t context,
  uint16_t *output,
  uint32_t *output_length
) {
  PCRE2_SIZE length = *output_length;
  pcre2_match_data *data = pcre2_match_data_create_from_pattern((pcre2_code *)code, NULL);
  int result = pcre2_substitute(
    (pcre2_code *)code,
    subject,
    subject_length,
    0,
    options,
    data,
    (pcre2_match_context *)context,
    replacement,
    replacement_length,
    output,
    &length
  );
  pcre2_match_data_free(data);
  *output_length = (uint32_t)length;
  return result;
}

EMSCRIPTEN_KEEPALIVE int32_t tsk_error_message(int32_t code, uint16_t *buffer, uint32_t length) {
  return pcre2_get_error_message(code, buffer, length);
}
