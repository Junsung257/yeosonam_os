begin;

drop function if exists public.apply_blog_publication_rollout_evaluation_v1(
  text,date,bigint,text,text,text,boolean,boolean,integer,integer,integer,integer,text[],jsonb
);
drop table if exists public.blog_publication_rollout_evaluations;
drop table if exists public.blog_publication_rollout_state;

commit;
