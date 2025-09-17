INSERT INTO products (sku, name, price, stock) VALUES
  ('SRV-DIAG', 'Diagnostic Service', 80.00, 100),
  ('PRT-BATT', 'Laptop Battery', 280.00, 20),
  ('PRT-SCRN', '14" IPS Screen', 520.00, 10),
  ('ACC-BAG', 'Waterproof Laptop Bag', 95.00, 35)
ON CONFLICT (sku) DO NOTHING;

INSERT INTO customers (name, phone, email) VALUES
  ('Aiman Rahman', '+60123456780', 'aiman@example.com'),
  ('Nurul Hana', '+60135551234', 'nurul@example.com')
ON CONFLICT (phone) DO NOTHING;

-- contoh tiket awal (akan wujud hanya jika tiada)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM tickets) THEN
    INSERT INTO tickets (ticket_code, customer_id, device, issue, estimate, status, notes)
    VALUES
      ('T-00001', (SELECT id FROM customers WHERE phone = '+60123456780'), 'Dell XPS 13', 'Screen flickering after spill', 450.00, 'DIAGNOSING', 'Awaiting parts'),
      ('T-00002', (SELECT id FROM customers WHERE phone = '+60135551234'), 'Lenovo ThinkPad T14', 'Battery draining fast', 280.00, 'IN_REPAIR', 'Battery replacement in progress');
  END IF;
END $$;
