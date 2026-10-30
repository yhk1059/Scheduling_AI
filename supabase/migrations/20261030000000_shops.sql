-- 병동을 매장으로 바꾼다 (ADR-020). 저장 데이터가 없어 이름만 옮긴다.
alter table public.wards rename to shops;

alter policy "wards_select_own" on public.shops rename to "shops_select_own";
alter policy "wards_insert_own" on public.shops rename to "shops_insert_own";
alter policy "wards_update_own" on public.shops rename to "shops_update_own";
alter policy "wards_delete_own" on public.shops rename to "shops_delete_own";

alter trigger wards_set_updated_at on public.shops rename to shops_set_updated_at;
alter function public.wards_set_updated_at() rename to shops_set_updated_at;
