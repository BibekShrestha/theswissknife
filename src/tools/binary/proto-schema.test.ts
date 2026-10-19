import { describe, expect, it } from 'vitest'
import { parseProto } from './proto-schema'

describe('.proto subset parser', () => {
  it('reads messages, nested types, enums, oneofs and maps', () => {
    const s = parseProto(`
      syntax = "proto3";
      package acme.v1;
      import "google/protobuf/timestamp.proto";
      option java_package = "com.acme";

      /* Orders */
      message Order {
        reserved 9, 10 to 12;
        reserved "legacy";
        option deprecated = true;
        uint64 id = 1 [json_name = "orderId"];
        repeated Line lines = 2;
        oneof payment { string card = 3; Cash cash = 4; }
        map<string, Line> by_sku = 5;
        Status status = 6;
        google.protobuf.Timestamp created = 7;
        message Line { string sku = 1; int32 qty = 2; }
        message Cash { int64 cents = 1; }
      }
      enum Status { option allow_alias = true; NEW = 0; DONE = 1; FINISHED = 1; }
      service Orders { rpc Get (Order) returns (Order) { option (x) = { a: 1 }; } }
    `)
    expect(s.errors).toEqual([])
    expect(s.order).toEqual(['acme.v1.Order', 'acme.v1.Order.Line', 'acme.v1.Order.Cash'])
    const order = s.messages.get('acme.v1.Order')!
    const f = (n: number) => order.fields.get(n)!
    expect(f(1)).toMatchObject({ name: 'id', type: 'uint64', kind: 'scalar' })
    expect(f(2)).toMatchObject({ name: 'lines', label: 'repeated', type: 'acme.v1.Order.Line', kind: 'message' })
    expect(f(3)).toMatchObject({ name: 'card', type: 'string' })
    expect(f(4)).toMatchObject({ type: 'acme.v1.Order.Cash', kind: 'message' })
    expect(f(5)).toMatchObject({ kind: 'message', type: 'acme.v1.Order.BySkuEntry', map: true, written: 'map<string, Line>' })
    expect(s.messages.get('acme.v1.Order.BySkuEntry')!.fields.get(2)).toMatchObject({ type: 'acme.v1.Order.Line', kind: 'message' })
    expect(f(6)).toMatchObject({ type: 'acme.v1.Status', kind: 'enum' })
    expect(f(7)).toMatchObject({ kind: 'unknown' })
    expect(s.enums.get('acme.v1.Status')).toEqual(new Map([[0, 'NEW'], [1, 'DONE']]))
    expect(s.notes.join(' ')).toMatch(/Imports are not followed/)
  })

  it('resolves fully qualified names and proto2 labels', () => {
    const s = parseProto(`
      syntax = "proto2";
      message A { required int32 x = 1; optional .B b = 2; optional group G = 3 { optional int32 y = 4; } }
      message B { optional A a = 1; }
    `)
    expect(s.errors).toEqual([])
    expect(s.messages.get('A')!.fields.get(1)).toMatchObject({ label: 'required', type: 'int32' })
    expect(s.messages.get('A')!.fields.get(2)).toMatchObject({ type: 'B', kind: 'message' })
    expect(s.messages.get('A')!.fields.has(3)).toBe(false)
    expect(s.notes.join(' ')).toMatch(/groups are skipped/)
  })

  it('reports errors with line and column, and keeps going', () => {
    const s = parseProto('message A {\n  int32 x = ;\n  string y = 2;\n}\nmessage B { int32 z = 1 }\nwhat;')
    expect(s.errors[0]).toBe('2:13: expected a number, found ";"')
    expect(s.messages.get('A')!.fields.get(2)).toMatchObject({ name: 'y' })
    expect(s.messages.has('B')).toBe(true)
    expect(s.errors).toContain('6:1: unexpected "what" at the top level')
    expect(s.errors.some((e) => e.startsWith('5:25:'))).toBe(true)
  })

  it('flags duplicate field numbers', () => {
    expect(parseProto('message A { int32 a = 1; int32 b = 1; }').errors).toEqual(['A: field number 1 is used twice'])
  })

  it('survives junk without hanging', () => {
    for (const junk of ['{{{{', '}}}}', 'message', 'message A {', 'message A { map<', '"unterminated', '/* open', 'enum E { A = ', ';;;;', 'message A { oneof o { repeated int32 x = 1; } }']) {
      expect(() => parseProto(junk)).not.toThrow()
    }
    const deep = `${'message M { '.repeat(200)}${'}'.repeat(200)}`
    expect(parseProto(deep).errors.join(' ')).toMatch(/nested more than 64/)
  })
})
