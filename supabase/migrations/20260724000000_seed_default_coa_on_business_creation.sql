-- Migration: 20260724000000_seed_default_coa_on_business_creation.sql
-- Description: Automatically seed 30 world-class standard Chart of Accounts (COA) when a new business is created, and populate existing businesses.

-- 1. Create or replace the trigger function
CREATE OR REPLACE FUNCTION public.seed_default_coa_for_business(p_business_id uuid)
RETURNS void AS $$
BEGIN
    INSERT INTO public.accounts (code, name, type, sub_type, business_id)
    VALUES
        -- ASSET (100000 - 199999)
        ('101000', 'Kas POS (Tunai)', 'ASSET', 'bank_cash', p_business_id),
        ('101100', 'Rekening Bank Utama', 'ASSET', 'bank_cash', p_business_id),
        ('101200', 'Bank / QRIS POS', 'ASSET', 'bank_cash', p_business_id),
        ('101300', 'Kas Kecil / Petty Cash', 'ASSET', 'bank_cash', p_business_id),
        ('102000', 'Persediaan Barang Dagangan', 'ASSET', 'current_assets', p_business_id),
        ('103000', 'Piutang Usaha', 'ASSET', 'receivable', p_business_id),
        ('105000', 'Beban Dibayar di Muka', 'ASSET', 'current_assets', p_business_id),
        ('120000', 'Peralatan & Inventaris Kantor', 'ASSET', 'fixed_assets', p_business_id),
        ('129000', 'Akumulasi Penyusutan Aset Tetap', 'ASSET', 'fixed_assets', p_business_id),

        -- LIABILITY (200000 - 299999)
        ('201000', 'Hutang Usaha', 'LIABILITY', 'payable', p_business_id),
        ('201100', 'Hutang Gaji & Upah', 'LIABILITY', 'payable', p_business_id),
        ('201200', 'Hutang Pajak (PPN/PPh)', 'LIABILITY', 'current_liabilities', p_business_id),
        ('202000', 'Pendapatan Diterima di Muka', 'LIABILITY', 'current_liabilities', p_business_id),

        -- EQUITY (300000 - 399999)
        ('301000', 'Modal Pemilik', 'EQUITY', 'equity', p_business_id),
        ('302000', 'Prive / Penarikan Pemilik', 'EQUITY', 'equity', p_business_id),
        ('303000', 'Laba Ditahan', 'EQUITY', 'equity', p_business_id),

        -- REVENUE (400000 - 499999)
        ('401000', 'Pendapatan Penjualan POS', 'REVENUE', 'income', p_business_id),
        ('401100', 'Potongan & Retur Penjualan', 'REVENUE', 'income', p_business_id),
        ('402000', 'Pendapatan Ongkir', 'REVENUE', 'income', p_business_id),
        ('403000', 'Pendapatan Lain-lain & Biaya Admin', 'REVENUE', 'other_income', p_business_id),

        -- EXPENSE (500000 - 599999)
        ('501000', 'Harga Pokok Penjualan (HPP)', 'EXPENSE', 'cogs', p_business_id),
        ('502000', 'Penyesuaian Persediaan', 'EXPENSE', 'expense', p_business_id),
        ('503000', 'Beban Operasional', 'EXPENSE', 'expense', p_business_id),
        ('503100', 'Beban Pemasaran, Iklan & Promosi', 'EXPENSE', 'expense', p_business_id),
        ('503200', 'Beban Utilitas (Listrik/Air/Internet)', 'EXPENSE', 'expense', p_business_id),
        ('503300', 'Beban Gaji, Tunjangan & Upah', 'EXPENSE', 'expense', p_business_id),
        ('503400', 'Beban Perlengkapan & ATK', 'EXPENSE', 'expense', p_business_id),
        ('503500', 'Beban Transportasi & Perjalanan Dinas', 'EXPENSE', 'expense', p_business_id),
        ('503600', 'Beban Sewa Tempat & Bangunan', 'EXPENSE', 'expense', p_business_id),
        ('503700', 'Beban Pemeliharaan & Perbaikan', 'EXPENSE', 'expense', p_business_id),
        ('503800', 'Beban Pajak, Retribusi & Perizinan', 'EXPENSE', 'expense', p_business_id),
        ('503900', 'Beban Konsumsi & Entertainment', 'EXPENSE', 'expense', p_business_id),
        ('504000', 'Beban Bunga & Administrasi Bank', 'EXPENSE', 'expense', p_business_id),
        ('505000', 'Beban Penyusutan Aset Tetap', 'EXPENSE', 'depreciation', p_business_id)
    ON CONFLICT (business_id, code) DO NOTHING;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 2. Trigger handler function for AFTER INSERT on businesses
CREATE OR REPLACE FUNCTION public.trg_seed_default_coa_on_business_creation()
RETURNS TRIGGER AS $$
BEGIN
    PERFORM public.seed_default_coa_for_business(NEW.id);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. Create Trigger
DROP TRIGGER IF EXISTS trg_seed_default_coa_on_business_creation ON public.businesses;
CREATE TRIGGER trg_seed_default_coa_on_business_creation
AFTER INSERT ON public.businesses
FOR EACH ROW
EXECUTE FUNCTION public.trg_seed_default_coa_on_business_creation();

-- 4. Seed default COA for all existing businesses in database
DO $$
DECLARE
    biz RECORD;
BEGIN
    FOR biz IN SELECT id FROM public.businesses LOOP
        PERFORM public.seed_default_coa_for_business(biz.id);
    END LOOP;
END;
$$;
